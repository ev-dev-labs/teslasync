/**
 * TripReplayCharts — behaviour + hardening coverage.
 *
 * TripReplayCharts is the trip-replay speed/power timeline: an area chart framed
 * by a <ChartContainer>, wrapped in a value-sync <ChartTimeRangeProvider>, with a
 * playhead <ReferenceLine> and a render-only <ChartCursorBridge> sibling that
 * forwards persistent cursor-sync moves back to the parent's `onSeekToIndex`.
 *
 * The file has two public exports — the component and the `nearestIndexByTime`
 * binary-search helper — plus two non-exported internals (the chart + the
 * bridge) that this suite reaches through the component. Every branch and the
 * behaviour that would silently regress is exercised:
 *
 *   1. nearestIndexByTime — empty / null / single-element / exact / between-
 *      sample (both directions + tie) / clamp / duplicate-time cases; it returns
 *      the ROW index (not the `.index` value).
 *   2. Panel chrome — the i18n title + subtitle + mandatory accessible chart
 *      label always frame the section, and the value-sync provider + height are
 *      wired through.
 *   3. Series / axis / gradient bindings — speed & power areas bind their keys,
 *      names, palette strokes, gradients and DUAL y-axes; the left axis label
 *      tracks the `speedUnit` prop while the right axis is fixed to kW; the
 *      x-axis binds the numeric `time` key; and the full data array reaches the
 *      chart with value-based sync props + the hover handler threaded on.
 *   4. Playhead — the ReferenceLine is drawn at the current sample's `time`
 *      (including the falsy `time === 0` edge), and omitted when currentIndex is
 *      out of range or there is no data.
 *   5. Click-to-seek — a chart click resolves the recharts row index back to the
 *      sample's positions `.index` via onSeekToIndex; null / missing / out-of-
 *      range activeTooltipIndex are all ignored.
 *   6. Cursor-sync bridge — a persistent cursor write is mapped value→nearest
 *      row→positions `.index` and forwarded; repeats coalesce; a numeric string
 *      is coerced; non-finite values are ignored; an empty data set never seeks.
 *   7. Empty & null-safety (the hardening) — an empty array and an `undefined`
 *      data prop both surface the accessible empty state instead of a blank
 *      panel or a `.length`-of-undefined crash, while the panel chrome remains.
 *
 * Per the repo convention (see ElevationChart.test.tsx / SessionCurveChart.test.tsx):
 * react-i18next is stubbed to echo the English fallback so asserted copy is
 * decoupled from the locale bundle, and the `@/components/charts` barrel is
 * doubled — its ResponsiveContainer renders 0×0 in jsdom, so the series / axis /
 * data bindings and the sync wiring would otherwise be unobservable. The sync
 * hooks read hoisted state so the persistent-cursor bridge can be driven
 * deterministically. The `@/components/feedback` EmptyState is the REAL
 * implementation so the rendered `role="status"` + copy are genuinely exercised.
 * Network is never touched (this component has no data source of its own).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  TripReplayCharts,
  nearestIndexByTime,
  type TripReplayChartPoint,
} from './TripReplayCharts';

// ── Hoisted mutable state driving the mocked sync hooks + prop capture. ──
type SyncMouseState = { activeLabel?: string | number } | null;
type ClickState = { activeTooltipIndex?: number } | null;

const state = vi.hoisted(() => ({
  onMouseMove: (() => {}) as (s: SyncMouseState) => void,
  syncProps: {} as {
    syncId?: string;
    syncMethod?: 'index' | 'value';
    onMouseMove?: (s: SyncMouseState) => void;
  },
  syncedX: null as string | number | null,
}));

const captured = vi.hoisted(() => ({
  areaChart: [] as Array<{
    data?: ReadonlyArray<Record<string, unknown>>;
    syncId?: string;
    syncMethod?: string;
    className?: string;
    onMouseMove?: (s: SyncMouseState) => void;
    onClick?: (s: ClickState) => void;
    children?: ReactNode;
  }>,
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

// ── charts barrel double: the provider + ResponsiveContainer + AreaChart render
//    their children so the series/axis/data bindings surface as testable DOM;
//    the sync hooks read hoisted state so the persistent-cursor bridge and the
//    onMouseMove wiring can be driven from a test. ──
vi.mock('@/components/charts', () => {
  const Inert = () => null;
  return {
    ChartTimeRangeProvider: ({
      syncId,
      syncMethod,
      children,
    }: {
      syncId?: string;
      syncMethod?: string;
      children?: ReactNode;
    }) => (
      <div
        data-testid="sync-provider"
        data-sync-id={String(syncId ?? '')}
        data-sync-method={String(syncMethod ?? '')}
      >
        {children}
      </div>
    ),
    useSyncedCursor: () => state.syncProps,
    useSyncedReferenceLineX: () => state.syncedX,
    chartGrid: {},
    axisTick: {},
    fmt: (v: number, d = 0) => Number(v).toFixed(d),
    CHART_COLORS: ['#00f0ff', '#ff00aa', '#00ffaa'],
    AREA_DEFAULTS: { type: 'monotone', strokeWidth: 2 },
    areaGradient: (id: string, color: string) => (
      <span data-testid="area-gradient" data-id={id} data-color={color} />
    ),
    ChartTooltip: Inert,
    CartesianGrid: Inert,
    Tooltip: Inert,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ChartContainer: ({
      title,
      subtitle,
      ariaLabel,
      height,
      children,
    }: {
      title?: string;
      subtitle?: string;
      ariaLabel?: string;
      height?: number;
      children?: ReactNode | ((context: {
        hiddenSeries: { isHidden: (key: string) => boolean };
      }) => ReactNode);
    }) => {
        const content = typeof children === 'function'
          ? children({ hiddenSeries: { isHidden: () => false } })
          : children;
        return (
          <section aria-label="chart-container" data-height={String(height ?? '')}>
            <h3>{title}</h3>
            {subtitle ? <p data-testid="cc-subtitle">{subtitle}</p> : null}
            <div role="img" aria-label={ariaLabel}>
              {content}
            </div>
          </section>
        );
      },
      ChartLegend: Inert,
    AreaChart: (props: {
      data?: ReadonlyArray<Record<string, unknown>>;
      syncId?: string;
      syncMethod?: string;
      className?: string;
      onMouseMove?: (s: SyncMouseState) => void;
      onClick?: (s: ClickState) => void;
      children?: ReactNode;
    }) => {
      captured.areaChart.push(props);
      return (
        <div
          data-testid="area-chart"
          data-sync-id={String(props.syncId ?? '')}
          data-sync-method={String(props.syncMethod ?? '')}
          data-class={String(props.className ?? '')}
        >
          <span data-testid="area-chart-data">{JSON.stringify(props.data ?? [])}</span>
          {props.children}
        </div>
      );
    },
    Area: (p: {
      dataKey?: string;
      name?: string;
      stroke?: string;
      yAxisId?: string;
      fill?: string;
    }) => (
      <span
        data-testid="area-series"
        data-key={String(p.dataKey ?? '')}
        data-name={String(p.name ?? '')}
        data-stroke={String(p.stroke ?? '')}
        data-yaxis={String(p.yAxisId ?? '')}
        data-fill={String(p.fill ?? '')}
      />
    ),
    XAxis: (p: { dataKey?: string; type?: string }) => (
      <span data-testid="x-axis" data-key={String(p.dataKey ?? '')} data-type={String(p.type ?? '')} />
    ),
    YAxis: (p: { yAxisId?: string; orientation?: string; label?: { value?: string } }) => (
      <span
        data-testid="y-axis"
        data-yaxisid={String(p.yAxisId ?? '')}
        data-orientation={String(p.orientation ?? 'left')}
        data-label={String(p.label?.value ?? '')}
      />
    ),
    ReferenceLine: (p: { x?: string | number; stroke?: string; yAxisId?: string }) => (
      <span
        data-testid="reference-line"
        data-x={String(p.x ?? '')}
        data-stroke={String(p.stroke ?? '')}
        data-yaxis={String(p.yAxisId ?? '')}
      />
    ),
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────
// `index` is deliberately offset from the row position (100 + row) so assertions
// distinguish the positions `.index` (what onSeekToIndex must receive) from the
// row index nearestIndexByTime returns and from the `time` axis value.
const DATA: TripReplayChartPoint[] = [
  { index: 100, time: 0, speed: 0, power: 0 },
  { index: 101, time: 1, speed: 35, power: 25 },
  { index: 102, time: 2, speed: 65, power: 50 },
  { index: 103, time: 3, speed: 80, power: 70 },
  { index: 104, time: 4, speed: 50, power: 30 },
];

function renderCharts(props?: Partial<Parameters<typeof TripReplayCharts>[0]>) {
  const onSeekToIndex = props?.onSeekToIndex ?? vi.fn();
  const merged = {
    data: DATA,
    currentIndex: 0,
    speedUnit: 'km/h',
    ...props,
    onSeekToIndex,
  };
  return { onSeek: onSeekToIndex, ...render(<TripReplayCharts {...merged} />) };
}

const seriesByKey = (key: string) =>
  screen.getAllByTestId('area-series').find((el) => el.getAttribute('data-key') === key);
const axisById = (id: string) =>
  screen.getAllByTestId('y-axis').find((el) => el.getAttribute('data-yaxisid') === id);
const gradientById = (id: string) =>
  screen.getAllByTestId('area-gradient').find((el) => el.getAttribute('data-id') === id);

beforeEach(() => {
  captured.areaChart.length = 0;
  state.onMouseMove = vi.fn();
  state.syncProps = { syncId: 'trip-replay', syncMethod: 'value', onMouseMove: state.onMouseMove };
  state.syncedX = null;
});

afterEach(() => {
  cleanup();
});

// ── 1. nearestIndexByTime (pure helper) ──────────────────────────────────────

describe('nearestIndexByTime', () => {
  it('returns 0 for an empty array', () => {
    expect(nearestIndexByTime([], 5)).toBe(0);
  });

  it('returns 0 for undefined / null data (null-safety)', () => {
    expect(nearestIndexByTime(undefined as unknown as TripReplayChartPoint[], 5)).toBe(0);
    expect(nearestIndexByTime(null as unknown as TripReplayChartPoint[], 5)).toBe(0);
  });

  it('returns 0 for a single-element array regardless of the target', () => {
    const one: TripReplayChartPoint[] = [{ index: 7, time: 42, speed: 1, power: 1 }];
    expect(nearestIndexByTime(one, -999)).toBe(0);
    expect(nearestIndexByTime(one, 999)).toBe(0);
  });

  it('returns the exact ROW index on an exact time match', () => {
    expect(nearestIndexByTime(DATA, 0)).toBe(0);
    expect(nearestIndexByTime(DATA, 2)).toBe(2);
    expect(nearestIndexByTime(DATA, 4)).toBe(4);
  });

  it('snaps to the nearer neighbour between two samples', () => {
    expect(nearestIndexByTime(DATA, 2.3)).toBe(2);
    expect(nearestIndexByTime(DATA, 2.7)).toBe(3);
    // Exact midpoint ties resolve to the upper (>=) sample.
    expect(nearestIndexByTime(DATA, 2.5)).toBe(3);
  });

  it('clamps requests below the first and above the last sample', () => {
    expect(nearestIndexByTime(DATA, -50)).toBe(0);
    expect(nearestIndexByTime(DATA, 9999)).toBe(DATA.length - 1);
  });

  it('lands on the leftmost row of a duplicate-time run', () => {
    const dup: TripReplayChartPoint[] = [
      { index: 0, time: 0, speed: 0, power: 0 },
      { index: 1, time: 5, speed: 0, power: 0 },
      { index: 2, time: 5, speed: 0, power: 0 },
      { index: 3, time: 9, speed: 0, power: 0 },
    ];
    expect(nearestIndexByTime(dup, 5)).toBe(1);
  });
});

// ── 2. Panel chrome + provider wiring ────────────────────────────────────────

describe('TripReplayCharts — panel chrome', () => {
  it('frames the timeline with the i18n title, subtitle and accessible chart label', () => {
    renderCharts();

    expect(screen.getByRole('heading', { name: 'Speed & Power Timeline' })).toBeInTheDocument();
    expect(screen.getByTestId('cc-subtitle')).toHaveTextContent('Click to seek replay position');
    expect(
      screen.getByRole('img', { name: 'Trip replay speed and power timeline area chart' }),
    ).toBeInTheDocument();
  });

  it('wraps the charts in a value-sync provider using the default syncId', () => {
    renderCharts();

    const provider = screen.getByTestId('sync-provider');
    expect(provider).toHaveAttribute('data-sync-id', 'trip-replay');
    expect(provider).toHaveAttribute('data-sync-method', 'value');
  });

  it('honours a custom syncId for isolated cursor-sync groups', () => {
    renderCharts({ syncId: 'trip-replay-xyz' });

    expect(screen.getByTestId('sync-provider')).toHaveAttribute('data-sync-id', 'trip-replay-xyz');
  });

  it('defaults the container height to 220 and forwards a custom height', () => {
    const { unmount } = renderCharts();
    expect(screen.getByLabelText('chart-container')).toHaveAttribute('data-height', '220');
    unmount();

    renderCharts({ height: 340 });
    expect(screen.getByLabelText('chart-container')).toHaveAttribute('data-height', '340');
  });
});

// ── 3. Series / axis / gradient bindings (populated) ─────────────────────────

describe('TripReplayCharts — series, axes and gradients', () => {
  it('feeds the full data array with value-based sync props + hover handler onto the chart', () => {
    renderCharts({ speedUnit: 'km/h' });

    const chart = screen.getByTestId('area-chart');
    expect(chart).toHaveAttribute('data-sync-id', 'trip-replay');
    expect(chart).toHaveAttribute('data-sync-method', 'value');
    expect(chart).toHaveAttribute('data-class', 'cursor-pointer');

    expect(JSON.parse(screen.getByTestId('area-chart-data').textContent || '[]')).toEqual(DATA);
    // The chart's onMouseMove is the persistent-cursor writer from useSyncedCursor.
    expect(captured.areaChart.at(-1)?.onMouseMove).toBe(state.onMouseMove);
  });

  it('binds the speed area to the left axis with its i18n name, palette stroke and gradient', () => {
    renderCharts();

    const speed = seriesByKey('speed');
    expect(speed).toHaveAttribute('data-yaxis', 'speed');
    expect(speed).toHaveAttribute('data-name', 'Speed');
    expect(speed).toHaveAttribute('data-stroke', '#00f0ff');
    expect(speed).toHaveAttribute('data-fill', 'url(#speedGrad)');
  });

  it('binds the power area to the right axis with its i18n name, palette stroke and gradient', () => {
    renderCharts();

    const power = seriesByKey('power');
    expect(power).toHaveAttribute('data-yaxis', 'power');
    expect(power).toHaveAttribute('data-name', 'Power');
    expect(power).toHaveAttribute('data-stroke', '#ff00aa');
    expect(power).toHaveAttribute('data-fill', 'url(#powerGrad)');
  });

  it('binds the numeric time key to the x-axis', () => {
    renderCharts();

    const x = screen.getByTestId('x-axis');
    expect(x).toHaveAttribute('data-key', 'time');
    expect(x).toHaveAttribute('data-type', 'number');
  });

  it('labels the left axis with the provided speedUnit and the right axis with kW', () => {
    renderCharts({ speedUnit: 'mph' });

    expect(axisById('speed')).toHaveAttribute('data-label', 'mph');
    const power = axisById('power');
    expect(power).toHaveAttribute('data-label', 'kW');
    expect(power).toHaveAttribute('data-orientation', 'right');
  });

  it('renders both fill gradients with stable ids and the matching palette colours', () => {
    renderCharts();

    expect(gradientById('speedGrad')).toHaveAttribute('data-color', '#00f0ff');
    expect(gradientById('powerGrad')).toHaveAttribute('data-color', '#ff00aa');
  });
});

// ── 4. Playhead reference line ───────────────────────────────────────────────

describe('TripReplayCharts — playhead reference line', () => {
  it('draws the playhead at the current sample time on the speed axis', () => {
    renderCharts({ currentIndex: 2 });

    const ref = screen.getByTestId('reference-line');
    expect(ref).toHaveAttribute('data-x', '2'); // DATA[2].time, not DATA[2].index (102)
    expect(ref).toHaveAttribute('data-yaxis', 'speed');
  });

  it('renders the playhead at time zero (guards against a falsy-0 omission bug)', () => {
    renderCharts({ currentIndex: 0 });

    expect(screen.getByTestId('reference-line')).toHaveAttribute('data-x', '0');
  });

  it('omits the playhead when currentIndex is out of range', () => {
    renderCharts({ currentIndex: 99 });

    expect(screen.queryByTestId('reference-line')).not.toBeInTheDocument();
    // The chart itself still renders.
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
  });
});

// ── 5. Click-to-seek ─────────────────────────────────────────────────────────

describe('TripReplayCharts — click to seek', () => {
  it('resolves the clicked recharts row to the sample positions index', () => {
    const { onSeek } = renderCharts();

    captured.areaChart.at(-1)?.onClick?.({ activeTooltipIndex: 2 });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(102); // DATA[2].index
  });

  it('ignores a null click state', () => {
    const { onSeek } = renderCharts();

    captured.areaChart.at(-1)?.onClick?.(null);

    expect(onSeek).not.toHaveBeenCalled();
  });

  it('ignores a click with no active tooltip index', () => {
    const { onSeek } = renderCharts();

    captured.areaChart.at(-1)?.onClick?.({});

    expect(onSeek).not.toHaveBeenCalled();
  });

  it('ignores an out-of-range active tooltip index', () => {
    const { onSeek } = renderCharts();

    captured.areaChart.at(-1)?.onClick?.({ activeTooltipIndex: 99 });
    captured.areaChart.at(-1)?.onClick?.({ activeTooltipIndex: -1 });

    expect(onSeek).not.toHaveBeenCalled();
  });
});

// ── 6. Cursor-sync bridge (persistent cursor → onSeekToIndex) ─────────────────

describe('TripReplayCharts — cursor-sync bridge', () => {
  // The mocked useSyncedReferenceLineX reads state.syncedX at render time, so the
  // cursor value is established BEFORE mount (the bridge's mount effect then
  // forwards it). Multi-write cases pass a FRESH element per render so React does
  // not bail out on a referentially-identical element.
  const makeEl = (onSeek: (i: number) => void, data: TripReplayChartPoint[] = DATA) => (
    <TripReplayCharts data={data} currentIndex={0} speedUnit="km/h" onSeekToIndex={onSeek} />
  );

  it('does not seek before any cursor value is present', () => {
    const { onSeek } = renderCharts(); // state.syncedX starts null (beforeEach)

    expect(onSeek).not.toHaveBeenCalled();
  });

  it('maps a persistent cursor write value→nearest row→positions index and forwards it', () => {
    const onSeek = vi.fn();
    state.syncedX = 2;
    render(makeEl(onSeek));

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(102); // nearest row 2 → DATA[2].index
  });

  it('coerces a numeric-string cursor value before mapping', () => {
    const onSeek = vi.fn();
    state.syncedX = '3';
    render(makeEl(onSeek));

    expect(onSeek).toHaveBeenCalledWith(103); // DATA[3].index
  });

  it('snaps a between-sample cursor to the nearer row', () => {
    const onSeek = vi.fn();
    state.syncedX = 2.7;
    render(makeEl(onSeek));

    expect(onSeek).toHaveBeenLastCalledWith(103); // 2.7 → row 3
  });

  it('coalesces repeat writes that resolve to the same row (no double-seek)', () => {
    const onSeek = vi.fn();
    state.syncedX = 2.9; // → row 3
    const { rerender } = render(makeEl(onSeek));
    expect(onSeek).toHaveBeenCalledTimes(1);

    state.syncedX = 3.1; // still → row 3
    rerender(makeEl(onSeek)); // fresh element → real re-render → effect re-runs

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(103);
  });

  it('ignores a non-finite cursor value', () => {
    const onSeek = vi.fn();
    state.syncedX = 'not-a-number';
    render(makeEl(onSeek));

    expect(onSeek).not.toHaveBeenCalled();
  });

  it('never seeks when the data set is empty', () => {
    const onSeek = vi.fn();
    state.syncedX = 2;
    render(makeEl(onSeek, []));

    expect(onSeek).not.toHaveBeenCalled();
  });
});

// ── 7. Empty & null-safety (the hardening) ───────────────────────────────────

describe('TripReplayCharts — empty & null-safety', () => {
  it('shows an accessible empty state instead of a chart for an empty array', () => {
    renderCharts({ data: [] });

    expect(screen.getByRole('status')).toHaveTextContent('No telemetry data available');
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    // Panel chrome still frames the empty state.
    expect(screen.getByRole('heading', { name: 'Speed & Power Timeline' })).toBeInTheDocument();
  });

  it('treats an undefined data prop as empty instead of throwing on `.length`', () => {
    const renderUndefined = () =>
      render(
        <TripReplayCharts
          data={undefined as unknown as TripReplayChartPoint[]}
          currentIndex={0}
          speedUnit="km/h"
          onSeekToIndex={vi.fn()}
        />,
      );

    expect(renderUndefined).not.toThrow();
    expect(screen.getByRole('status')).toHaveTextContent('No telemetry data available');
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
  });
});
