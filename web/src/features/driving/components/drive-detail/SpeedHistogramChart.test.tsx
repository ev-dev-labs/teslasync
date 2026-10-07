/**
 * SpeedHistogramChart — behaviour + hardening coverage.
 *
 * SpeedHistogramChart is the drive-detail speed-distribution panel: a bar chart
 * of "% of drive" per speed bucket, framed by a ChartContainer that also emits
 * the screen-reader/forced-colors fallback table. It has a single export (the
 * component); this suite exercises every branch and the behaviour that would
 * silently regress rather than smoke rendering:
 *
 *   1. Panel chrome — the i18n title + the mandatory accessible chart-figure
 *      label always frame the section, and the fixed 220px height is threaded.
 *   2. Populated bars — the guarded buckets reach <BarChart> untouched; the
 *      single <Bar> binds its key / colour / i18n series name; the x-axis binds
 *      the bucket `range`; and the fallback a11y table receives the mapped
 *      { range, pct } rows plus its localized column headers.
 *   3. Empty & null-safety (the hardening) — an empty array AND an `undefined`
 *      speedHistData both surface the accessible `role="status"` empty state
 *      (never a blank panel or a `.length`-of-undefined crash) while keeping the
 *      panel chrome, and the empty-state glyph is marked decorative.
 *   4. Stability — the caller-supplied array is never mutated.
 *
 * Per the repo convention (see ElevationChart.test.tsx): react-i18next is
 * stubbed to echo the English fallback so asserted copy is decoupled from the
 * locale bundle; <FadeIn> is flattened; and the `@/components/charts` barrel is
 * doubled — its ResponsiveContainer renders 0×0 in jsdom, so the series / data
 * bindings would otherwise be unobservable. lucide-react is the REAL module so
 * the decorative-glyph a11y attribute is asserted on a real <svg>. Network is
 * never touched (this component has no data source of its own).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { SpeedHistogramBucket } from './types';

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

// ── Flatten the entry animation — framer-motion / matchMedia are irrelevant. ──
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// ── charts barrel double: ResponsiveContainer + BarChart render their children
//    so the series/data bindings surface as testable DOM. ChartContainer echoes
//    its title, ariaLabel, height and the a11y fallback table (data + columns)
//    so the fallback-table wiring is observable without the real recharts SVG. ──
vi.mock('@/components/charts', () => {
  const Inert = () => null;
  return {
    ChartTooltip: Inert,
    Tooltip: Inert,
    CartesianGrid: Inert,
    YAxis: Inert,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ChartContainer: ({
      title,
      ariaLabel,
      height,
      className,
      data,
      dataColumns,
      children,
    }: {
      title?: string;
      ariaLabel?: string;
      height?: number;
      className?: string;
      data?: ReadonlyArray<Record<string, unknown>>;
      dataColumns?: ReadonlyArray<{ key: string; label: string }>;
      children?: ReactNode;
    }) => (
      <section
        aria-label="chart-container"
        data-height={String(height ?? '')}
        data-json={JSON.stringify(data ?? [])}
        data-columns={JSON.stringify(dataColumns ?? [])}
        className={className}
      >
        <h3>{title}</h3>
        <div role="img" aria-label={ariaLabel} />
        {children}
      </section>
    ),
    BarChart: ({
      data,
      children,
    }: {
      data?: ReadonlyArray<Record<string, unknown>>;
      children?: ReactNode;
    }) => (
      <div data-testid="bar-chart" data-json={JSON.stringify(data ?? [])}>
        {children}
      </div>
    ),
    Bar: (p: { dataKey?: string; fill?: string; name?: string }) => (
      <span
        data-testid="bar"
        data-key={String(p.dataKey ?? '')}
        data-fill={String(p.fill ?? '')}
        data-name={String(p.name ?? '')}
      />
    ),
    XAxis: (p: { dataKey?: string }) => (
      <span data-testid="xaxis" data-key={String(p.dataKey ?? '')} />
    ),
  };
});

import { SpeedHistogramChart } from './SpeedHistogramChart';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BUCKETS: SpeedHistogramBucket[] = [
  { range: '0–20', pct: 15 },
  { range: '20–40', pct: 45 },
  { range: '40–60', pct: 30 },
  { range: '60+', pct: 10 },
];

/** Rows the recharts BarChart double received as its `data` prop. */
function readChartRows(): SpeedHistogramBucket[] {
  return JSON.parse(screen.getByTestId('bar-chart').getAttribute('data-json') || '[]');
}

/** Rows the ChartContainer double received as its a11y fallback `data` prop. */
function readTableRows(): Array<Record<string, unknown>> {
  const section = screen.getByLabelText('chart-container');
  return JSON.parse(section.getAttribute('data-json') || '[]');
}

// ── 1. Panel chrome ──────────────────────────────────────────────────────────

describe('SpeedHistogramChart — panel chrome', () => {
  it('frames the panel with the i18n title', () => {
    render(<SpeedHistogramChart speedHistData={BUCKETS} />);

    expect(
      screen.getByRole('heading', { name: /Speed Histogram/i }),
    ).toBeInTheDocument();
  });

  it('exposes the mandatory accessible chart-figure label', () => {
    render(<SpeedHistogramChart speedHistData={BUCKETS} />);

    const figure = screen.getByRole('img');
    expect(figure.getAttribute('aria-label')).toContain('Speed-bucket distribution');
  });

  it('threads the fixed 220px chart height to the container', () => {
    render(<SpeedHistogramChart speedHistData={BUCKETS} />);

    expect(screen.getByLabelText('chart-container')).toHaveAttribute('data-height', '220');
  });
});

// ── 2. Populated bars ────────────────────────────────────────────────────────

describe('SpeedHistogramChart — populated bars', () => {
  it('feeds the guarded buckets straight to the bar chart and hides the empty state', () => {
    render(<SpeedHistogramChart speedHistData={BUCKETS} />);

    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(readChartRows()).toEqual(BUCKETS);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('binds the single bar to the pct key with its colour and i18n series name', () => {
    render(<SpeedHistogramChart speedHistData={BUCKETS} />);

    const bar = screen.getByTestId('bar');
    expect(bar).toHaveAttribute('data-key', 'pct');
    expect(bar).toHaveAttribute('data-fill', '#a855f7');
    const name = bar.getAttribute('data-name') ?? '';
    expect(name).toContain('%');
    expect(name).toContain('of drive');
  });

  it('binds the x-axis to the bucket range label', () => {
    render(<SpeedHistogramChart speedHistData={BUCKETS} />);

    expect(screen.getByTestId('xaxis')).toHaveAttribute('data-key', 'range');
  });

  it('mirrors the buckets into the a11y fallback table with localized column headers', () => {
    render(<SpeedHistogramChart speedHistData={BUCKETS} />);

    // The fallback-table rows are the mapped { range, pct } projection.
    expect(readTableRows()).toEqual([
      { range: '0–20', pct: 15 },
      { range: '20–40', pct: 45 },
      { range: '40–60', pct: 30 },
      { range: '60+', pct: 10 },
    ]);

    const columns = JSON.parse(
      screen.getByLabelText('chart-container').getAttribute('data-columns') || '[]',
    );
    expect(columns).toEqual([
      { key: 'range', label: 'Speed range' },
      { key: 'pct', label: '% of drive' },
    ]);
  });

  it('does not mutate the caller-supplied buckets array', () => {
    const source: SpeedHistogramBucket[] = [
      { range: '0–20', pct: 60 },
      { range: '20–40', pct: 40 },
    ];
    render(<SpeedHistogramChart speedHistData={source} />);

    expect(source).toHaveLength(2);
    expect(source).toEqual([
      { range: '0–20', pct: 60 },
      { range: '20–40', pct: 40 },
    ]);
    expect(readChartRows()).toEqual(source);
  });
});

// ── 3. Empty & null-safety (the hardening) ───────────────────────────────────

describe('SpeedHistogramChart — empty & null-safety', () => {
  it('renders an accessible empty state (not a blank panel) for an empty array', () => {
    render(<SpeedHistogramChart speedHistData={[]} />);

    expect(screen.getByRole('status')).toHaveTextContent('No telemetry data available');
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('keeps the panel chrome (title + figure) alongside the empty state', () => {
    render(<SpeedHistogramChart speedHistData={[]} />);

    expect(screen.getByRole('heading', { name: /Speed Histogram/i })).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('marks the empty-state glyph decorative (aria-hidden) so only the message is announced', () => {
    const { container } = render(<SpeedHistogramChart speedHistData={[]} />);

    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('treats an undefined speedHistData prop as empty instead of throwing on `.length`', () => {
    const renderUndefined = () =>
      render(
        <SpeedHistogramChart
          speedHistData={undefined as unknown as SpeedHistogramBucket[]}
        />,
      );
    expect(renderUndefined).not.toThrow();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    // The fallback table degrades to an empty row set rather than crashing.
    expect(readTableRows()).toEqual([]);
  });
});
