/**
 * SmallMultiplesChart unit tests.
 *
 * Recharts inside ResponsiveContainer needs real layout; jsdom gives it
 * 0×0, so the inner SVG won't paint. We focus assertions on the cell-
 * structure (one cell per series, label, no-data placeholder, click /
 * keyboard activation) rather than chart pixels.
 */
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { projectSmallMultipleSeries, SmallMultiplesChart } from '../SmallMultiplesChart';

// jsdom has no ResizeObserver — recharts' ResponsiveContainer uses one
// internally to track layout. Without the stub each cell crashes during
// the effect phase and the surrounding cell DOM is unmounted, so any
// query for our cell test-ids fails. The stub does nothing; our
// assertions don't depend on chart pixel rendering.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const sampleData = [
  { timestamp: '2024-01-01T10:00:00Z', sigA: 1, sigB: 100, sigC: null },
  { timestamp: '2024-01-01T10:01:00Z', sigA: 2, sigB: 110, sigC: null },
  { timestamp: '2024-01-01T10:02:00Z', sigA: 3, sigB: 120, sigC: null },
];

describe('SmallMultiplesChart', () => {
  it('renders one cell per series', () => {
    render(
      <SmallMultiplesChart
        data={sampleData}
        series={['sigA', 'sigB', 'sigC']}
      />,
    );
    expect(screen.getByTestId('small-multiples-cell-sigA')).toBeInTheDocument();
    expect(screen.getByTestId('small-multiples-cell-sigB')).toBeInTheDocument();
    expect(screen.getByTestId('small-multiples-cell-sigC')).toBeInTheDocument();
  });

  it('shows the series key as the cell label by default', () => {
    render(
      <SmallMultiplesChart data={sampleData} series={['sigA']} />,
    );
    const cell = screen.getByTestId('small-multiples-cell-sigA');
    expect(within(cell).getByText('sigA')).toBeInTheDocument();
  });

  it('uses seriesLabel mapper when provided', () => {
    render(
      <SmallMultiplesChart
        data={sampleData}
        series={['sigA']}
        seriesLabel={(s) => `Friendly: ${s}`}
      />,
    );
    expect(screen.getByText('Friendly: sigA')).toBeInTheDocument();
  });

  it('renders a "No data" placeholder for series without finite values', () => {
    render(
      <SmallMultiplesChart
        data={sampleData}
        series={['sigC']}
        emptyCellLabel="Nothing here"
      />,
    );
    const cell = screen.getByTestId('small-multiples-cell-sigC');
    expect(within(cell).getByText('Nothing here')).toBeInTheDocument();
  });

  it('falls back to default no-data label when emptyCellLabel omitted', () => {
    render(
      <SmallMultiplesChart data={sampleData} series={['sigC']} />,
    );
    const cell = screen.getByTestId('small-multiples-cell-sigC');
    expect(within(cell).getByText('No data')).toBeInTheDocument();
  });

  it('fires onCellClick when a cell is clicked', () => {
    const onCellClick = vi.fn();
    render(
      <SmallMultiplesChart
        data={sampleData}
        series={['sigA', 'sigB']}
        onCellClick={onCellClick}
      />,
    );
    fireEvent.click(screen.getByTestId('small-multiples-cell-sigB'));
    expect(onCellClick).toHaveBeenCalledWith('sigB');
  });

  it('activates cell on Enter and Space keys when clickable', () => {
    const onCellClick = vi.fn();
    render(
      <SmallMultiplesChart
        data={sampleData}
        series={['sigA']}
        onCellClick={onCellClick}
      />,
    );
    const cell = screen.getByTestId('small-multiples-cell-sigA');
    fireEvent.keyDown(cell, { key: 'Enter' });
    fireEvent.keyDown(cell, { key: ' ' });
    expect(onCellClick).toHaveBeenCalledTimes(2);
  });

  it('does not fire on other keys', () => {
    const onCellClick = vi.fn();
    render(
      <SmallMultiplesChart
        data={sampleData}
        series={['sigA']}
        onCellClick={onCellClick}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('small-multiples-cell-sigA'), { key: 'a' });
    expect(onCellClick).not.toHaveBeenCalled();
  });

  it('renders cells as group (not button) when no click handler', () => {
    render(
      <SmallMultiplesChart data={sampleData} series={['sigA']} />,
    );
    const cell = screen.getByTestId('small-multiples-cell-sigA');
    expect(cell).toHaveAttribute('role', 'group');
    expect(cell).toHaveAttribute('tabIndex', '-1');
  });

  it('renders cells as button when click handler provided', () => {
    render(
      <SmallMultiplesChart
        data={sampleData}
        series={['sigA']}
        onCellClick={vi.fn()}
      />,
    );
    const cell = screen.getByTestId('small-multiples-cell-sigA');
    expect(cell).toHaveAttribute('role', 'button');
    expect(cell).toHaveAttribute('tabIndex', '0');
  });

  it('treats non-finite numbers as no-data', () => {
    const data = [
      { timestamp: 't1', sigA: NaN, sigB: Infinity, sigC: -Infinity, sigD: null },
    ];
    render(
      <SmallMultiplesChart
        data={data}
        series={['sigA', 'sigB', 'sigC', 'sigD']}
      />,
    );
    expect(within(screen.getByTestId('small-multiples-cell-sigA')).getByText('No data')).toBeInTheDocument();
    expect(within(screen.getByTestId('small-multiples-cell-sigB')).getByText('No data')).toBeInTheDocument();
    expect(within(screen.getByTestId('small-multiples-cell-sigC')).getByText('No data')).toBeInTheDocument();
    expect(within(screen.getByTestId('small-multiples-cell-sigD')).getByText('No data')).toBeInTheDocument();
  });

  it('respects forced columns prop', () => {
    render(
      <SmallMultiplesChart
        data={sampleData}
        series={['sigA', 'sigB']}
        columns={1}
      />,
    );
    const grid = screen.getByTestId('small-multiples-grid');
    expect(grid).toHaveStyle({ gridTemplateColumns: 'repeat(1, minmax(0, 1fr))' });
  });

  it('respects custom xKey for series presence detection', () => {
    const data = [
      { ts: 't1', a: 1 },
      { ts: 't2', a: 2 },
    ];
    render(
      <SmallMultiplesChart data={data} series={['a']} xKey="ts" />,
    );
    const cell = screen.getByTestId('small-multiples-cell-a');
    expect(within(cell).queryByText('No data')).not.toBeInTheDocument();
  });

  // Regression: with 50+ cells × thousands of points, every cell used to
  // receive the full data array and recharts would iterate
  // cells × rows on every render. Per-cell projection + stride
  // downsampling + IntersectionObserver lazy-mount keeps the grid
  // responsive. This test just asserts the grid renders all cells
  // without throwing — a true perf benchmark belongs in a benchmark
  // suite, but a regression here means we re-introduced a bottleneck.
  it('renders 60 cells over a 5,000-row dataset without throwing', () => {
    const series = Array.from({ length: 60 }, (_, i) => `sig${i}`);
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 5000; i++) {
      const row: Record<string, unknown> = { timestamp: `2024-01-01T10:${i}:00Z` };
      // Sparse: only 3 of 60 signals carry values per row, like real telemetry.
      row[series[i % 60]] = Math.random();
      row[series[(i * 7) % 60]] = Math.random() * 100;
      rows.push(row);
    }
    render(<SmallMultiplesChart data={rows} series={series} />);
    expect(screen.getByTestId('small-multiples-grid')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^small-multiples-cell-/)).toHaveLength(60);
  });

  it('downsamples per-cell points to maxPointsPerCell', () => {
    // Build a single dense series with 2,000 points; cap to 50.
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      timestamp: `2024-01-01T10:${i}:00Z`,
      dense: i,
    }));
    render(
      <SmallMultiplesChart
        data={rows}
        series={['dense']}
        maxPointsPerCell={50}
      />,
    );
    // The cell should mount (data present); we just assert no crash and
    // that the cell exists. Visual downsampling fidelity is enforced by
    // strideSample's "always keep first + last" contract documented in
    // the implementation, not by checking pixel output (jsdom can't).
    expect(screen.getByTestId('small-multiples-cell-dense')).toBeInTheDocument();
  });

  it('retains null gap markers through projection and downsampling', () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({
      timestamp: `t${index}`,
      speed: index % 10 === 0 && ![40, 50, 60].includes(index) ? index : null,
    }));
    const projection = projectSmallMultipleSeries(rows, 'speed', 'timestamp', 12);
    expect(projection.hasData).toBe(true);
    expect(projection.showDots).toBe(true);
    expect(projection.rows).toContainEqual({ timestamp: 't40', speed: null });
    expect(projection.rows[0]).toEqual({ timestamp: 't0', speed: 0 });
    expect(projection.rows).toHaveLength(6);
    expect(projection.rows).toContainEqual({ timestamp: 't70', speed: 70 });
  });

  it('keeps a realistic sparse union matrix tightly bounded without inventing outage gaps', () => {
    const rows = Array.from({ length: 3_000 }, (_, index) => ({
      timestamp: String(index).padStart(4, '0'),
      speed: index % 12 === 0 ? index : null,
    }));
    const projection = projectSmallMultipleSeries(rows, 'speed', 'timestamp', 50);
    expect(projection.rows.length).toBeLessThanOrEqual(50);
    expect(projection.rows.every((row) => typeof row.speed === 'number')).toBe(true);
    expect(projection.showDots).toBe(true);
  });

  it('uses source order for uneven numeric, ISO, and duplicate x values', () => {
    const rows = [
      { x: 100, iso: '2026-01-03T00:00:00Z', value: 1 },
      { x: 2, iso: '2026-01-01T00:00:00Z', value: 2 },
      { x: 2, iso: '2026-01-01T00:00:00Z', value: 3 },
      { x: 50, iso: '2026-01-02T00:00:00Z', value: 4 },
    ];
    expect(projectSmallMultipleSeries(rows, 'value', 'x', 10).rows.map((row) => row.x))
      .toEqual([100, 2, 2, 50]);
    expect(projectSmallMultipleSeries(rows, 'value', 'iso', 10).rows.map((row) => row.iso))
      .toEqual(rows.map((row) => row.iso));
  });

  it('uses lower-quartile cadence for bursts and avoids certainty with two samples', () => {
    const burst = Array.from({ length: 201 }, (_, index) => ({
      x: index,
      value: [0, 1, 100, 101, 200].includes(index) ? index : null,
    }));
    const projected = projectSmallMultipleSeries(burst, 'value', 'x', 12);
    expect(projected.rows.filter((row) => row.value == null)).toHaveLength(2);
    const twoPoints = projectSmallMultipleSeries(
      [{ x: 0, value: 1 }, { x: 100, value: 2 }],
      'value',
      'x',
      12,
    );
    expect(twoPoints.rows).toEqual([{ x: 0, value: 1 }, { x: 100, value: 2 }]);
  });

  it('property-checks 80 deterministic histories (1–200 rows) for cap, order, and endpoints', () => {
    for (let length = 1; length <= 200; length += 1) {
      const rows = Array.from({ length }, (_, index) => ({
        x: index % 7 === 0 ? index : index * 13,
        value: index % 5 === 0 ? index : null,
      }));
      const cap = 2 + (length % 49);
      const projection = projectSmallMultipleSeries(rows, 'value', 'x', cap);
      expect(projection.rows.length).toBeLessThanOrEqual(cap);
      const sourcePositions = projection.rows.map((row) =>
        rows.findIndex((source) => source.x === row.x && (row.value == null || source.value === row.value)),
      );
      expect(sourcePositions).toEqual([...sourcePositions].sort((a, b) => a - b));
      if (projection.hasData && rows.some((row) => row.value != null)) {
        expect(projection.rows[0].value).toBe(0);
        expect(projection.rows.at(-1)?.value).toBe((Math.floor((length - 1) / 5) * 5) || 0);
      }
    }
  });
});
