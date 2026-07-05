/**
 * SOCRouteChart — behaviour + hardening contract.
 *
 * SOCRouteChart renders the "Battery Along Route" area chart on the Trip
 * Planner page. It owns no data source of its own — the parent
 * (`TripPlannerPage`) feeds it the plan's `soc_curve` (SI **meters** +
 * SOC %), the `charge_stops`, and the `min_arrival_soc` slider value — so
 * these tests pin the display behaviour that matters and the hardening this
 * elevation added:
 *
 *   - EMPTY   → an empty (or undefined) soc_curve collapses to the shared
 *               EmptyState placeholder inside the chart frame, never a blank
 *               panel, and no series/table is emitted;
 *   - THE REAL BUG FIXED HERE — the X axis used to plot raw `distance_m`
 *               (meters) under a hard-coded "km" label and never convert, so a
 *               100 km route drew 0..100000 beneath a "km" axis. The series,
 *               the axis label, the fallback table, the tooltip, AND the
 *               charge-stop reference lines now all convert `distance_m` through
 *               the real `convertDistanceFromSI` at the render boundary and read
 *               in the user's display unit (km or mi) on ONE shared scale;
 *   - CHARGE STOPS → each stop is matched to the first onward soc_curve point
 *               near its `charge_from_soc` and drawn as a vertical marker whose
 *               X lands on the converted distance scale; unmatched stops draw
 *               nothing;
 *   - NULL-SAFE → null per-point readings, an undefined soc_curve/charge_stops,
 *               and a non-finite `minArrivalSOC` degrade gracefully instead of
 *               plotting NaN or throwing on `.map`/`.length`;
 *   - PERF    → the converted series is memoised on [socCurve, distanceUnit],
 *               so an identical re-render returns a stable reference and a unit
 *               change recomputes it.
 *
 * Conventions (mirror the sibling drivetrain-health / drive-detail suites):
 *   - `react-i18next` is stubbed to echo the inline English fallback and run
 *     `{{token}}` interpolation so localized labels are assertable.
 *   - The jsdom-hostile recharts barrel (`@/components/charts`) and the shared
 *     `EmptyState` are replaced with inert prop-capturing stubs so the derived
 *     chart data / axis labels / reference-line positions / tooltip formatters
 *     are assertable (Recharts measures the SVG bbox and jsdom returns 0×0).
 *   - `useUnits` is the settings-backed boundary hook, mocked to drive the
 *     km/mi branch while the REAL `convertDistanceFromSI` from
 *     `@/lib/unitConversion` runs. The component exposes no interactive
 *     controls, so there is no userEvent surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { SOCRouteChart } from './SOCRouteChart';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { TripSOCPoint, TripChargeStop, TripLocation } from '@/types/driving';

/* ── Controllable mock state, hoisted above the vi.mock factories ─────────── */
type RefLine = {
  x?: unknown;
  y?: unknown;
  label?: unknown;
  stroke?: unknown;
  strokeDasharray?: unknown;
};

const H = vi.hoisted(() => ({
  distance: 'km' as 'km' | 'mi',
  container: null as null | {
    title: string;
    ariaLabel: string;
    height?: number;
    data?: Array<Record<string, unknown>>;
    dataColumns?: Array<{ key: string; label: string }>;
  },
  areaData: null as null | Array<{ distance: number; soc: number }>,
  xAxis: null as null | Record<string, unknown>,
  yAxis: null as null | Record<string, unknown>,
  area: null as null | Record<string, unknown>,
  tooltip: null as null | Record<string, unknown>,
  refLines: [] as RefLine[],
}));

/* ── i18n: echo the English fallback + interpolate {{tokens}} ─────────────── */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (opts && typeof opts === 'object') {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Drive the distance unit while the REAL SI converter runs. The component only
// reads `unitPrefs.distance`.
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: H.distance,
      speed: H.distance === 'mi' ? 'mph' : 'km/h',
      temperature: '\u00B0C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
  }),
}));

// The empty branch wraps the shared EmptyState; a lightweight status stub keeps
// the DOM flat and the message assertable.
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ message }: { message?: string }) => (
    <div role="status" data-testid="empty-state">
      {message}
    </div>
  ),
}));

/* ── Inert recharts barrel — capture derived chart data / series props ────── */
interface StubColumn {
  key: string;
  label: string;
  format?: (v: unknown) => string;
}
interface StubContainerProps {
  title: string;
  ariaLabel: string;
  height?: number;
  data?: Array<Record<string, unknown>>;
  dataColumns?: StubColumn[];
  children?: ReactNode;
}

vi.mock('@/components/charts', () => ({
  chartGrid: {},
  axisTick: {},
  AREA_DEFAULTS: { type: 'monotone', strokeWidth: 2 },
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive">{children}</div>
  ),
  AreaChart: ({
    data,
    children,
  }: {
    data?: Array<{ distance: number; soc: number }>;
    children?: ReactNode;
  }) => {
    H.areaData = data ?? null;
    return (
      <svg data-testid="area-chart" data-count={data?.length ?? 0}>
        {children}
      </svg>
    );
  },
  Area: (props: Record<string, unknown>) => {
    H.area = props;
    return (
      <g
        data-testid="area"
        data-datakey={String(props.dataKey ?? '')}
        data-stroke={String(props.stroke ?? '')}
        data-fill={String(props.fill ?? '')}
      />
    );
  },
  XAxis: (props: Record<string, unknown>) => {
    H.xAxis = props;
    const label = props.label as { value?: unknown } | undefined;
    return (
      <g
        data-testid="x-axis"
        data-datakey={String(props.dataKey ?? '')}
        data-label={String(label?.value ?? '')}
      />
    );
  },
  YAxis: (props: Record<string, unknown>) => {
    H.yAxis = props;
    const label = props.label as { value?: unknown } | undefined;
    return (
      <g
        data-testid="y-axis"
        data-domain={JSON.stringify(props.domain ?? null)}
        data-label={String(label?.value ?? '')}
      />
    );
  },
  CartesianGrid: () => null,
  Tooltip: (props: Record<string, unknown>) => {
    H.tooltip = props;
    return <g data-testid="tooltip" />;
  },
  ReferenceLine: (props: Record<string, unknown>) => {
    const label = props.label as { value?: unknown } | undefined;
    H.refLines.push({
      x: props.x,
      y: props.y,
      label: label?.value,
      stroke: props.stroke,
      strokeDasharray: props.strokeDasharray,
    });
    return (
      <g
        data-testid="reference-line"
        data-x={props.x != null ? String(props.x) : ''}
        data-y={props.y != null ? String(props.y) : ''}
        data-label={String(label?.value ?? '')}
        data-stroke={String(props.stroke ?? '')}
      />
    );
  },
  ChartContainer: ({ title, ariaLabel, height, data, dataColumns, children }: StubContainerProps) => {
    H.container = { title, ariaLabel, height, data, dataColumns };
    const hasTable = !!(data && data.length > 0 && dataColumns && dataColumns.length > 0);
    return (
      <figure role="img" aria-label={ariaLabel}>
        <h3>{title}</h3>
        <div data-testid="chart-body">{children}</div>
        {hasTable ? (
          <table data-testid="fallback-table">
            <thead>
              <tr>
                {dataColumns!.map((c) => (
                  <th key={c.key} data-testid={`col-${c.key}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data!.map((row, i) => (
                <tr key={i} data-testid="fallback-row">
                  {dataColumns!.map((c) => {
                    const raw = row[c.key];
                    const cell = c.format ? c.format(raw) : raw == null ? '\u2014' : String(raw);
                    return (
                      <td key={c.key} data-col={c.key}>
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </figure>
    );
  },
}));

/* ── Fixtures ─────────────────────────────────────────────────────────────── */
const LOC: TripLocation = { lat: 47.6, lng: -122.3, name: 'Somewhere' };

function stop(charge_from_soc: number, overrides: Partial<TripChargeStop> = {}): TripChargeStop {
  return {
    name: 'Supercharger',
    location: LOC,
    charge_from_soc,
    charge_to_soc: 80,
    charge_duration_s: 1200,
    energy_wh: 30000,
    cost: 12,
    is_recommended: true,
    ...overrides,
  };
}

// 0, 50, 100 km worth of SI meters → clean km integers; SOC descending.
const CURVE: TripSOCPoint[] = [
  { distance_m: 0, soc: 90 },
  { distance_m: 50000, soc: 60 },
  { distance_m: 100000, soc: 30 },
];

/* ── DOM/read helpers ─────────────────────────────────────────────────────── */
const roundTo1 = (n: number) => Math.round(n * 10) / 10;
const plottedDistances = () => (H.areaData ?? []).map((d) => d.distance);
const plottedSoc = () => (H.areaData ?? []).map((d) => d.soc);
const minLine = () => H.refLines.find((r) => r.x == null && r.y != null) ?? null;
const stopLines = () => H.refLines.filter((r) => r.x != null);
const distanceCells = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('td[data-col="distance"]')).map((el) => el.textContent ?? '');

function reset() {
  H.distance = 'km';
  H.container = null;
  H.areaData = null;
  H.xAxis = null;
  H.yAxis = null;
  H.area = null;
  H.tooltip = null;
  H.refLines = [];
}
beforeEach(reset);

/* ── EMPTY / NULL-SAFETY ───────────────────────────────────────────────────── */
describe('SOCRouteChart — empty + null-safety', () => {
  it('renders the placeholder (never a blank panel) and no series for an empty curve', () => {
    render(<SOCRouteChart socCurve={[]} chargeStops={[]} minArrivalSOC={20} />);

    expect(screen.getByRole('status')).toHaveTextContent('Plan a trip to see the SOC curve');
    // No plotted series and no fallback table when there is nothing to chart…
    expect(screen.queryByTestId('area-chart')).toBeNull();
    expect(H.container?.data).toBeUndefined();
    expect(screen.queryByTestId('fallback-table')).toBeNull();
    // …but the frame still carries the localized title + accessible name.
    expect(screen.getByRole('heading', { name: 'Battery Along Route' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Planned route battery state-of-charge area chart' }),
    ).toBeInTheDocument();
  });

  it('tolerates an undefined socCurve/chargeStops without throwing (?? [] hardening)', () => {
    // The typed props are required, but a JS caller may omit them.
    expect(() =>
      render(
        <SOCRouteChart
          socCurve={undefined as unknown as TripSOCPoint[]}
          chargeStops={undefined as unknown as TripChargeStop[]}
          minArrivalSOC={20}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('area-chart')).toBeNull();
  });

  it('keeps null per-point readings finite (?? 0) instead of plotting NaN', () => {
    const dirty: TripSOCPoint[] = [
      { distance_m: null as unknown as number, soc: null as unknown as number },
      { distance_m: 50000, soc: 60 },
    ];
    render(<SOCRouteChart socCurve={dirty} chargeStops={[]} minArrivalSOC={20} />);

    // The null point becomes (0 km, 0 %); the finite sibling converts normally.
    expect(plottedDistances()).toEqual([0, 50]);
    expect(plottedSoc()).toEqual([0, 60]);
    expect(plottedDistances().every((n) => Number.isFinite(n))).toBe(true);
  });

  it('guards a non-finite minArrivalSOC to 0 rather than plotting a phantom line', () => {
    render(
      <SOCRouteChart
        socCurve={CURVE}
        chargeStops={[]}
        minArrivalSOC={undefined as unknown as number}
      />,
    );

    expect(minLine()).not.toBeNull();
    expect(minLine()?.y).toBe(0);
    expect(minLine()?.label).toBe('Min 0%');
  });
});

/* ── UNIT CONVERSION — km (identity-ish) ──────────────────────────────────── */
describe('SOCRouteChart — km scale', () => {
  it('converts distance_m to km on the series, axis label, tooltip and table', () => {
    const { container } = render(
      <SOCRouteChart socCurve={CURVE} chargeStops={[]} minArrivalSOC={20} />,
    );

    // 0 / 50000 / 100000 m → 0 / 50 / 100 km, SOC unchanged.
    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-count', '3');
    expect(plottedDistances()).toEqual([0, 50, 100]);
    expect(plottedSoc()).toEqual([90, 60, 30]);
    // Axis label + fallback header read the display unit.
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-label', 'km');
    expect(screen.getByTestId('col-distance')).toHaveTextContent('Distance (km)');
    expect(distanceCells(container)).toEqual(['0', '50', '100']);
    // Y axis is fixed 0..100 and labelled from i18n.
    expect(screen.getByTestId('y-axis')).toHaveAttribute('data-domain', '[0,100]');
    expect(screen.getByTestId('y-axis')).toHaveAttribute('data-label', 'SOC %');
  });

  it('formats the tooltip label + value in km with a percent suffix', () => {
    render(<SOCRouteChart socCurve={CURVE} chargeStops={[]} minArrivalSOC={20} />);

    const labelFormatter = H.tooltip?.labelFormatter as (v: unknown) => string;
    const formatter = H.tooltip?.formatter as (v: number) => [string, string];
    expect(labelFormatter(50)).toBe('50 km');
    expect(formatter(60)).toEqual(['60%', 'SOC']);
  });

  it('draws the min-arrival reference line at the SOC value with a localized label', () => {
    render(<SOCRouteChart socCurve={CURVE} chargeStops={[]} minArrivalSOC={25} />);

    expect(minLine()?.y).toBe(25);
    expect(minLine()?.label).toBe('Min 25%');
    expect(minLine()?.stroke).toBe('#ef4444');
    // The plotted series carries the SOC gradient fill + green stroke.
    expect(screen.getByTestId('area')).toHaveAttribute('data-datakey', 'soc');
    expect(screen.getByTestId('area')).toHaveAttribute('data-fill', 'url(#socGradient)');
    expect(screen.getByTestId('area')).toHaveAttribute('data-stroke', '#22c55e');
  });
});

/* ── UNIT CONVERSION — mi (the real bug fixed here) ───────────────────────── */
describe('SOCRouteChart — mi scale (series, axis, table & tooltip agree)', () => {
  it('converts every distance to miles on one shared scale', () => {
    H.distance = 'mi';
    const { container } = render(
      <SOCRouteChart socCurve={CURVE} chargeStops={[]} minArrivalSOC={20} />,
    );

    const expected = CURVE.map((p) => roundTo1(convertDistanceFromSI(p.distance_m, 'mi')));
    // 50000 m → 31.1 mi, 100000 m → 62.1 mi (via the REAL converter).
    expect(expected).toEqual([0, 31.1, 62.1]);
    expect(plottedDistances()).toEqual(expected);
    expect(distanceCells(container)).toEqual(expected.map(String));
    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-label', 'mi');
    expect(screen.getByTestId('col-distance')).toHaveTextContent('Distance (mi)');

    const labelFormatter = H.tooltip?.labelFormatter as (v: unknown) => string;
    expect(labelFormatter(31.1)).toBe('31.1 mi');
  });

  it('regression guard: never plots raw meters or the km value under a mi axis', () => {
    H.distance = 'mi';
    render(<SOCRouteChart socCurve={CURVE} chargeStops={[]} minArrivalSOC={20} />);

    // The old bug plotted 50000/100000 (meters); a naive fix would plot 50/100 (km).
    expect(plottedDistances()).not.toContain(50000);
    expect(plottedDistances()).not.toContain(100000);
    expect(plottedDistances()).not.toContain(50);
    expect(plottedDistances()).not.toContain(100);
  });
});

/* ── CHARGE STOPS → reference lines on the converted scale ────────────────── */
describe('SOCRouteChart — charge-stop reference lines', () => {
  // Two stops matched to onward soc_curve points near their charge_from_soc.
  const stopCurve: TripSOCPoint[] = [
    { distance_m: 0, soc: 90 },
    { distance_m: 40000, soc: 32 }, // ≈ stop 1 (from 30)
    { distance_m: 80000, soc: 22 }, // ≈ stop 2 (from 20)
    { distance_m: 120000, soc: 55 },
  ];

  it('places one vertical marker per matched stop at the converted km distance', () => {
    render(
      <SOCRouteChart socCurve={stopCurve} chargeStops={[stop(30), stop(20)]} minArrivalSOC={15} />,
    );

    const lines = stopLines();
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.x)).toEqual([40, 80]);
    expect(lines.map((l) => l.label)).toEqual(['\u26A1 Stop 1', '\u26A1 Stop 2']);
    expect(lines.every((l) => l.stroke === '#3b82f6')).toBe(true);
    // The min-arrival line is distinct (y set, x unset).
    expect(minLine()?.y).toBe(15);
  });

  it('converts stop markers to miles alongside the series', () => {
    H.distance = 'mi';
    render(
      <SOCRouteChart socCurve={stopCurve} chargeStops={[stop(30), stop(20)]} minArrivalSOC={15} />,
    );

    const expected = [40000, 80000].map((m) => roundTo1(convertDistanceFromSI(m, 'mi')));
    expect(expected).toEqual([24.9, 49.7]);
    expect(stopLines().map((l) => l.x)).toEqual(expected);
  });

  it('draws no stop marker when a stop matches no onward SOC point', () => {
    // All SOC values are far from charge_from_soc=30 (|90-30| >= 5) → no match.
    render(
      <SOCRouteChart
        socCurve={[
          { distance_m: 0, soc: 90 },
          { distance_m: 50000, soc: 88 },
        ]}
        chargeStops={[stop(30)]}
        minArrivalSOC={20}
      />,
    );

    expect(stopLines()).toHaveLength(0);
    // The series + min-arrival line still render.
    expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    expect(minLine()).not.toBeNull();
  });
});

/* ── MEMOISATION (perf facet) ─────────────────────────────────────────────── */
describe('SOCRouteChart — memoised series', () => {
  it('returns a stable series reference across re-renders with identical props', () => {
    const { rerender } = render(
      <SOCRouteChart socCurve={CURVE} chargeStops={[]} minArrivalSOC={20} />,
    );
    const first = H.areaData;

    rerender(<SOCRouteChart socCurve={CURVE} chargeStops={[]} minArrivalSOC={20} />);
    const second = H.areaData;

    // useMemo keyed on [socCurve, distanceUnit] returns the cached array unchanged.
    expect(second).toBe(first);
  });

  it('recomputes the series when the distance unit changes', () => {
    const { rerender } = render(
      <SOCRouteChart socCurve={CURVE} chargeStops={[]} minArrivalSOC={20} />,
    );
    const km = H.areaData;
    expect(km?.map((d) => d.distance)).toEqual([0, 50, 100]);

    H.distance = 'mi';
    rerender(<SOCRouteChart socCurve={CURVE} chargeStops={[]} minArrivalSOC={20} />);
    const mi = H.areaData;

    expect(mi).not.toBe(km);
    expect(mi?.map((d) => d.distance)).toEqual([0, 31.1, 62.1]);
  });
});
