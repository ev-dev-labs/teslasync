/**
 * ElevationChart — behaviour + hardening coverage.
 *
 * ElevationChart is the drive-detail elevation-vs-speed panel: an area (elevation,
 * metres, left axis) + line (speed, right axis) trace framed by a ChartContainer,
 * with a gain / loss / net summary strip above it and a persistent synced-cursor
 * reference line. It has a single export (the component); this suite exercises
 * every branch and the behaviour that would silently regress rather than smoke
 * rendering:
 *
 *   1. Panel chrome — the i18n title + the mandatory accessible chart-figure
 *      label always frame the section.
 *   2. Populated trace — the guarded points reach <ComposedChart> untouched; the
 *      elevation area + speed line bind their keys, colours and DUAL y-axes; and
 *      the speed line's series name tracks the active speed-unit preference
 *      (km/h ↔ mph).
 *   3. Gain / loss / net — the summary strip renders the stats-derived climb,
 *      descent and net (gain − loss), and marks its arrow glyphs decorative.
 *   4. Synced cursor — the persistent <ReferenceLine> is drawn at the shared x
 *      only when the cursor-sync store has a value, styled from chartTokens; and
 *      the syncId / syncMethod / onMouseMove wiring is threaded onto the chart.
 *   5. Empty & null-safety (the hardening) — a single point, an empty array, and
 *      an `undefined` chartData all surface the accessible empty state instead of
 *      a blank panel or a `.length`-of-undefined crash; and a missing `stats`
 *      defaults gain/loss/net to zero instead of throwing.
 *
 * Per the repo convention (see BatteryLevelChart.test.tsx / SessionCurveChart.test.tsx):
 * react-i18next is stubbed to echo the English fallback so asserted copy is
 * decoupled from the locale bundle; <FadeIn> is flattened; and the
 * `@/components/charts` barrel is doubled — its ResponsiveContainer renders 0×0
 * in jsdom, so the series / data bindings + the sync hooks would otherwise be
 * unobservable. `useUnits` is doubled so the speed-unit label is deterministic.
 * fmtNumber + chartTokens are the REAL modules (pure). Network is never touched
 * (this component has no data source of its own).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

import { chartTokens } from '@/lib/tokens';
import type { ChartDataPoint, DriveStats } from './types';

// ── Hoisted mutable state driving the mocked hooks/units per test. ──
const state = vi.hoisted(() => ({
  speed: 'km/h' as string,
  syncProps: {} as {
    syncId?: string;
    syncMethod?: 'index' | 'value';
    onMouseMove?: (s: { activeLabel?: string | number } | null) => void;
  },
  syncedX: null as string | number | null,
}));

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

// ── Unit prefs: control the speed unit the <Line> series binds. ──
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { speed: state.speed } }),
}));

// ── charts barrel double: ResponsiveContainer + ComposedChart render their
//    children so the series/data bindings surface as testable DOM; the sync
//    hooks read hoisted state so the persistent-cursor ReferenceLine and the
//    onMouseMove wiring can be driven from a test. ──
vi.mock('@/components/charts', () => {
  const Inert = () => null;
  return {
    useSyncedCursor: () => state.syncProps,
    useSyncedReferenceLineX: () => state.syncedX,
    ChartTooltip: Inert,
    Tooltip: Inert,
    CartesianGrid: Inert,
    XAxis: Inert,
    YAxis: Inert,
    ChartLegend: Inert,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ChartContainer: ({
      title,
      ariaLabel,
      height,
      className,
      children,
    }: {
      title?: string;
      ariaLabel?: string;
      height?: number;
      className?: string;
      children?: ReactNode | ((context: {
        hiddenSeries: { isHidden: (key: string) => boolean };
      }) => ReactNode);
    }) => {
      const content = typeof children === 'function'
        ? children({ hiddenSeries: { isHidden: () => false } })
        : children;
      return (
        <section
          aria-label="chart-container"
          data-height={String(height ?? '')}
          className={className}
        >
          <h3>{title}</h3>
          <div role="img" aria-label={ariaLabel} />
          {content}
        </section>
      );
    },
    ComposedChart: ({
      data,
      syncId,
      syncMethod,
      onMouseMove,
      children,
    }: {
      data?: ReadonlyArray<Record<string, unknown>>;
      syncId?: string;
      syncMethod?: string;
      onMouseMove?: (s: { activeLabel?: string | number } | null) => void;
      children?: ReactNode;
    }) => (
      <div
        data-testid="composed-chart"
        data-json={JSON.stringify(data ?? [])}
        data-syncid={String(syncId ?? '')}
        data-syncmethod={String(syncMethod ?? '')}
      >
        <button
          type="button"
          data-testid="fire-mousemove"
          onClick={() => onMouseMove?.({ activeLabel: '09:30' })}
        >
          move
        </button>
        {children}
      </div>
    ),
    Area: (p: { dataKey?: string; name?: string; stroke?: string; yAxisId?: string }) => (
      <span
        data-testid="area"
        data-key={String(p.dataKey ?? '')}
        data-name={String(p.name ?? '')}
        data-stroke={String(p.stroke ?? '')}
        data-yaxis={String(p.yAxisId ?? '')}
      />
    ),
    Line: (p: { dataKey?: string; name?: string; stroke?: string; yAxisId?: string }) => (
      <span
        data-testid="line"
        data-key={String(p.dataKey ?? '')}
        data-name={String(p.name ?? '')}
        data-stroke={String(p.stroke ?? '')}
        data-yaxis={String(p.yAxisId ?? '')}
      />
    ),
    ReferenceLine: (p: { x?: string | number; stroke?: string }) => (
      <span
        data-testid="reference-line"
        data-x={String(p.x ?? '')}
        data-stroke={String(p.stroke ?? '')}
      />
    ),
  };
});

import { ElevationChart } from './ElevationChart';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePoint(over: Partial<ChartDataPoint> = {}): ChartDataPoint {
  return {
    time: '09:00',
    speed: 30,
    battery: 80,
    elevation: 100,
    power: 10,
    outsideTemp: null,
    insideTemp: null,
    driverTemp: null,
    passengerTemp: null,
    idealRange: null,
    ratedRange: null,
    estRange: null,
    odometer: null,
    soc: null,
    usableSoc: null,
    tireFl: null,
    tireFr: null,
    tireRl: null,
    tireRr: null,
    climateOn: null,
    fanStatus: null,
    ...over,
  };
}

const POINTS: ChartDataPoint[] = [
  makePoint({ time: '09:00', elevation: 100, speed: 20 }),
  makePoint({ time: '09:05', elevation: 160, speed: 40 }),
  makePoint({ time: '09:10', elevation: 130, speed: 35 }),
];

function makeStats(over: Partial<DriveStats> = {}): DriveStats {
  return {
    maxSpd: 40,
    avgSpd: 30,
    minSpd: 20,
    powerMax: 50,
    powerMin: -10,
    avgPower: 12,
    energyWh: 9000,
    regenWh: 500,
    consumptionWhKm: 150,
    elevGain: 120,
    elevLoss: 45,
    avgOutsideTemp: null,
    avgInsideTemp: null,
    hasAnyTemp: false,
    insideTemps: [],
    outsideTemps: [],
    driverTemps: [],
    passengerTemps: [],
    climateStatus: null,
    avgFanSpeed: null,
    maxFanSpeed: null,
    startRange: null,
    endRange: null,
    odometerStart: 0,
    odometerEnd: 0,
    hasTirePressure: false,
    efficiencyPctPer100: null,
    ...over,
  };
}

function renderChart(chartData: ChartDataPoint[] = POINTS, stats: DriveStats = makeStats()) {
  return render(<ElevationChart chartData={chartData} stats={stats} />);
}

/** Rows the recharts ComposedChart double received as its `data` prop. */
function readChartRows(): ChartDataPoint[] {
  return JSON.parse(screen.getByTestId('composed-chart').getAttribute('data-json') || '[]');
}

beforeEach(() => {
  state.speed = 'km/h';
  state.syncProps = {};
  state.syncedX = null;
});

// ── 1. Panel chrome ──────────────────────────────────────────────────────────

describe('ElevationChart — panel chrome', () => {
  it('frames the panel with the i18n title', () => {
    renderChart();

    expect(
      screen.getByRole('heading', { name: /Elevation Profile/i }),
    ).toBeInTheDocument();
  });

  it('exposes the mandatory accessible chart-figure label', () => {
    renderChart();

    const figure = screen.getByRole('img');
    expect(figure.getAttribute('aria-label')).toContain('Elevation and speed');
  });
});

// ── 2. Populated trace ───────────────────────────────────────────────────────

describe('ElevationChart — populated trace', () => {
  it('feeds the guarded points straight to the composed chart and hides the empty state', () => {
    renderChart(POINTS);

    expect(screen.getByTestId('composed-chart')).toBeInTheDocument();
    expect(readChartRows()).toEqual(POINTS);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('binds the elevation area to the left axis with its i18n name and colour', () => {
    renderChart();

    const area = screen.getByTestId('area');
    expect(area).toHaveAttribute('data-key', 'elevation');
    expect(area).toHaveAttribute('data-yaxis', 'elev');
    expect(area).toHaveAttribute('data-stroke', '#10b981');
    expect(area).toHaveAttribute('data-name', 'Elevation (m)');
  });

  it('binds the speed line to the right axis with its colour', () => {
    renderChart();

    const line = screen.getByTestId('line');
    expect(line).toHaveAttribute('data-key', 'speed');
    expect(line).toHaveAttribute('data-yaxis', 'speed');
    expect(line).toHaveAttribute('data-stroke', '#a855f7');
  });

  it('labels the speed line with the active (metric) speed-unit preference', () => {
    renderChart();

    const name = screen.getByTestId('line').getAttribute('data-name') ?? '';
    expect(name).toContain('Speed');
    expect(name).toContain('km/h');
  });

  it('reflects the imperial speed unit when the preference is mph', () => {
    state.speed = 'mph';
    renderChart();

    const name = screen.getByTestId('line').getAttribute('data-name') ?? '';
    expect(name).toContain('mph');
    expect(name).not.toContain('km/h');
  });

  it('does not mutate the caller-supplied points array', () => {
    const source = [makePoint({ time: '08:00', elevation: 5 }), makePoint({ time: '08:01', elevation: 9 })];
    renderChart(source);

    expect(source).toHaveLength(2);
    expect(readChartRows()).toEqual(source);
  });
});

// ── 3. Gain / loss / net summary ─────────────────────────────────────────────

describe('ElevationChart — gain / loss / net summary', () => {
  it('renders climb, descent and the net (gain − loss) from stats', () => {
    const { container } = renderChart(POINTS, makeStats({ elevGain: 120, elevLoss: 45 }));

    const text = container.textContent ?? '';
    expect(text).toContain('gain');
    expect(text).toContain('loss');
    expect(text).toContain('Net');
    expect(text).toContain('120');
    expect(text).toContain('45');
    // Net = 120 − 45 = 75.
    expect(text).toContain('75');
  });

  it('marks the gain / loss arrow glyphs decorative (aria-hidden) so only the values are announced', () => {
    const { container } = renderChart();

    // ArrowUpRight + ArrowDownRight — both hidden from assistive tech.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(2);
  });
});

// ── 4. Synced persistent cursor ──────────────────────────────────────────────

describe('ElevationChart — synced persistent cursor', () => {
  it('draws the shared reference line at the persisted x, styled from chartTokens', () => {
    state.syncedX = '09:05';
    renderChart();

    const ref = screen.getByTestId('reference-line');
    expect(ref).toHaveAttribute('data-x', '09:05');
    expect(ref).toHaveAttribute('data-stroke', chartTokens.cursor.stroke);
  });

  it('omits the reference line when no cursor position is persisted', () => {
    state.syncedX = null;
    renderChart();

    expect(screen.queryByTestId('reference-line')).not.toBeInTheDocument();
  });

  it('threads the sync id / method and the mouse-move handler onto the chart', () => {
    const onMouseMove = vi.fn();
    state.syncProps = { syncId: 'drive-detail', syncMethod: 'index', onMouseMove };
    renderChart();

    const chart = screen.getByTestId('composed-chart');
    expect(chart).toHaveAttribute('data-syncid', 'drive-detail');
    expect(chart).toHaveAttribute('data-syncmethod', 'index');

    expect(onMouseMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('fire-mousemove'));
    expect(onMouseMove).toHaveBeenCalledTimes(1);
    expect(onMouseMove).toHaveBeenCalledWith({ activeLabel: '09:30' });
  });
});

// ── 5. Empty & null-safety (the hardening) ───────────────────────────────────

describe('ElevationChart — empty & null-safety', () => {
  it('renders an accessible empty state (not a blank panel) for a single point', () => {
    renderChart([makePoint()]);

    expect(screen.getByRole('status')).toHaveTextContent('No telemetry data available');
    expect(screen.queryByTestId('composed-chart')).not.toBeInTheDocument();
  });

  it('renders the empty state for an empty array while keeping the panel chrome', () => {
    renderChart([]);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('composed-chart')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Elevation Profile/i })).toBeInTheDocument();
  });

  it('treats an undefined chartData prop as empty instead of throwing on `.length`', () => {
    // NB: render directly (not via the default-param helper) so `undefined`
    // actually reaches the component instead of triggering the default.
    const renderUndefined = () =>
      render(
        <ElevationChart chartData={undefined as unknown as ChartDataPoint[]} stats={makeStats()} />,
      );
    expect(renderUndefined).not.toThrow();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('composed-chart')).not.toBeInTheDocument();
  });

  it('still plots the trace when stats is missing, defaulting gain/loss/net to zero', () => {
    const { container } = render(
      <ElevationChart chartData={POINTS} stats={undefined as unknown as DriveStats} />,
    );

    // The chart renders (no `stats.elevGain` crash) …
    expect(screen.getByTestId('composed-chart')).toBeInTheDocument();
    // … and the net summary falls back to a safe zero.
    const text = container.textContent ?? '';
    expect(text).toContain('Net');
    expect(text).toContain('0');
  });
});
