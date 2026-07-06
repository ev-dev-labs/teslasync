/**
 * MotorHistoryWidget — behavioural, branch, null-safety and a11y coverage for
 * the dashboard "Motor History" widget.
 *
 * The widget resolves a vehicle (`vehicleId` prop → first vehicle → id 0),
 * pulls the last 200 `MotorSnapshot`s (`useMotorHistory`), folds them into a
 * sorted `ChartDatum[]` (torque, display-unit stator temp, gear, lateral/long
 * G), and renders either a `WidgetChartSummary` (compact 1-col) or a two-axis
 * `ComposedChart` with a 100 °C danger band. Temperatures are stored in SI
 * Celsius and converted at the render boundary via the REAL `convertTempFromSI`
 * keyed off the user's `useUnits()` temperature preference.
 *
 * What this file pins:
 *   - the VEHICLE-ID resolution ladder (prop → first → 0) and the exact
 *     `useMotorHistory(id, 200)` hook contract;
 *   - `buildChartData`: torque = `di_torque` (0 preserved, null coalesced),
 *     stator temp = `di_stator_temp` ?? `motor_temp_c_front` (converted to the
 *     display unit, null when both absent), gear = `gear` ?? `shift_state`, the
 *     loosely-typed `lateral_accel`/`longitudinal_accel` overlays, the
 *     `ts` ?? `created_at` time key, the drop of rows lacking both, and the
 *     ascending time sort;
 *   - the UNIT boundary — °C is a passthrough; °F converts the trace, the
 *     danger threshold, the y-domain, the reference band and every label
 *     (regression guard: the memoised `toTemperatureDisplay` must stay stable
 *     so the chart/threshold memos actually memoise);
 *   - the SUMMARY stats — latest NON-null torque / stator (skipping trailing
 *     nulls), their `Nm` / temperature units, and the `—` placeholders;
 *   - LOADING (skeleton, no chart), EMPTY (`No motor history`, never a blank
 *     panel) and error degradation;
 *   - SIZING — compact hides the chart but keeps the stats; wide adds the two
 *     g-force overlays + axis labels; the normal 2-col does neither;
 *   - AXIS / TOOLTIP / REFERENCE-AREA wiring (dataKeys, formatters delegating
 *     to `formatDateTime`, the [0, tempMax] domain, the danger band); and
 *   - the REFRESH wiring (accessible chip → `refetch`) and the title heading.
 *
 * Strategy mirrors the repo convention (EnergyFlowWidget / StatorTempChart):
 * `@/api/hooks/useVehicles` is the network boundary via hoisted mocks; the
 * `@/components/charts` barrel is doubled (its real ResponsiveContainer renders
 * 0×0 in jsdom) with prop-recording stubs so the derived rows / axes / formatters
 * are observable; `./shared` is replaced with the REAL `WidgetChartSummary`
 * (imported straight from its file so the leaflet-laden barrel never loads);
 * the real `WidgetShell` + `DataFreshness` are exercised with their display
 * hooks stubbed; `react-i18next` echoes each `t(key, fallback)` fallback; and a
 * `<MemoryRouter>` wraps every render because `EmptyState` reaches for `<Link>`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { MotorSnapshot } from '@/api/types';

// ── Captured chart-subcomponent props (the unit under test) ─────────────────────
interface XAxisProps {
  dataKey?: string;
  tickFormatter?: (v: string) => string;
}
interface YAxisProps {
  yAxisId?: string;
  orientation?: string;
  domain?: [number, number];
  label?: { value?: string } | undefined;
  tickFormatter?: (v: number) => string;
}
interface TooltipProps {
  formatter?: (value: number, name: string) => unknown;
  labelFormatter?: (v: string) => string;
}
interface RefAreaProps {
  yAxisId?: string;
  y1?: number;
  y2?: number;
  fill?: string;
  fillOpacity?: number;
}
interface LineProps {
  yAxisId?: string;
  dataKey?: string;
  stroke?: string;
  name?: string;
}

// ── Hoisted mutable state referenced inside vi.mock factories ───────────────────
const hooks = vi.hoisted(() => ({ motor: vi.fn(), vehicles: vi.fn() }));
const unitState = vi.hoisted(() => ({ temperature: '°C' as string }));
const cap = vi.hoisted(() => ({
  xaxis: [] as XAxisProps[],
  yaxis: [] as YAxisProps[],
  tooltip: [] as TooltipProps[],
  refArea: [] as RefAreaProps[],
  lines: [] as LineProps[],
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useMotorHistory: (...args: unknown[]) => hooks.motor(...args),
  useVehicles: () => hooks.vehicles(),
}));

// Unit prefs — deterministic temperature unit; convertTempFromSI stays REAL.
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature: unitState.temperature } }),
}));

// Date + motion display hooks — stubbed so DataFreshness renders without a
// Settings provider. `formatDateTime` returns a recognizable marker so the
// axis / tooltip formatter wiring is assertable.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (v: unknown) => `@${String(v)}`,
    formatTime: (v: unknown) => String(v),
  }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 0 }),
}));

// i18n → return the developer fallback so copy reads as English.
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key);
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// Replace the `./shared` barrel with ONLY the real WidgetChartSummary, imported
// straight from its file so the barrel's WidgetMapView (→ react-leaflet) never
// evaluates in jsdom.
vi.mock('./shared', async () => {
  const actual = await vi.importActual<typeof import('./shared/WidgetChartSummary')>(
    './shared/WidgetChartSummary',
  );
  return { WidgetChartSummary: actual.WidgetChartSummary };
});

// charts barrel double — prop-recording stubs. ComposedChart serialises its
// `data` (the derived rows) into the DOM; the axes / tooltip / band / lines push
// their props so formatters, domains and bindings are directly assertable.
vi.mock('@/components/charts', () => ({
  chartGrid: null,
  chartMargin: {},
  chartAnimation: {},
  axisTick: {},
  axisTickSm: {},
  fmt: (v: unknown, decimals = 1) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n.toFixed(decimals) : String(v ?? '');
  },
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="responsive">{children}</div>
  ),
  ComposedChart: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
    <div data-testid="composed-chart" data-rows={JSON.stringify(data ?? [])}>
      {children}
    </div>
  ),
  XAxis: (p: XAxisProps) => {
    cap.xaxis.push(p);
    return <div data-testid="x-axis" data-key={p.dataKey ?? ''} />;
  },
  YAxis: (p: YAxisProps) => {
    cap.yaxis.push(p);
    return <div data-testid={`y-axis-${p.yAxisId ?? ''}`} />;
  },
  Tooltip: (p: TooltipProps) => {
    cap.tooltip.push(p);
    return <div data-testid="tooltip" />;
  },
  ReferenceArea: (p: RefAreaProps) => {
    cap.refArea.push(p);
    return (
      <div
        data-testid="reference-area"
        data-y1={String(p.y1)}
        data-y2={String(p.y2)}
        data-fill={String(p.fill)}
        data-axis={p.yAxisId ?? ''}
      />
    );
  },
  Line: (p: LineProps) => {
    cap.lines.push(p);
    return (
      <div
        data-testid={`line-${p.dataKey ?? ''}`}
        data-name={p.name ?? ''}
        data-stroke={p.stroke ?? ''}
      />
    );
  },
}));

import MotorHistoryWidget from './MotorHistoryWidget';

// ── Fixtures ────────────────────────────────────────────────────────────────────

const T1 = '2026-07-05T10:00:00.000Z';
const T2 = '2026-07-05T11:00:00.000Z';
const T3 = '2026-07-05T12:00:00.000Z';

type SnapshotOverrides = Partial<MotorSnapshot> & Record<string, unknown>;

function makeSnapshot(ts: string, over: SnapshotOverrides = {}): MotorSnapshot {
  return {
    ts,
    created_at: ts,
    torque_nm_front: null,
    torque_nm_rear: null,
    di_torque: null,
    motor_rpm_front: null,
    motor_rpm_rear: null,
    motor_temp_c_front: null,
    motor_temp_c_rear: null,
    inverter_temp_c: null,
    inverter_temp_rear: null,
    heatsink_temp_front: null,
    heatsink_temp_rear: null,
    motor_current_front: null,
    motor_current_rear: null,
    state_front: null,
    state_rear: null,
    shift_state: null,
    vbat_front: null,
    vbat_rear: null,
    ...over,
  } as MotorSnapshot;
}

interface QueryLike {
  data: MotorSnapshot[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function setHistory(over: Partial<QueryLike> = {}): QueryLike {
  const q: QueryLike = {
    data: [],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse(T3),
    refetch: vi.fn(),
    ...over,
  };
  hooks.motor.mockReturnValue(q);
  return q;
}

function setVehicles(list: Array<{ id: number }> | undefined, isLoading = false) {
  hooks.vehicles.mockReturnValue({ data: list, isLoading });
}

type Size = { cols: number; rows: number };

function renderWidget(size: Size = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <MotorHistoryWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

interface ChartRow {
  time: string;
  torque: number | null;
  statorTemp: number | null;
  gear: string | null;
  lateralG: number | null;
  longitudinalG: number | null;
}

function chartRows(): ChartRow[] {
  const raw = screen.getByTestId('composed-chart').getAttribute('data-rows') ?? '[]';
  return JSON.parse(raw) as ChartRow[];
}

const tempAxis = () => cap.yaxis.find((a) => a.yAxisId === 'temp');
const torqueAxis = () => cap.yaxis.find((a) => a.yAxisId === 'torque');
const lineKeys = () => cap.lines.map((l) => l.dataKey);

beforeEach(() => {
  vi.clearAllMocks();
  unitState.temperature = '°C';
  cap.xaxis.length = 0;
  cap.yaxis.length = 0;
  cap.tooltip.length = 0;
  cap.refArea.length = 0;
  cap.lines.length = 0;
  setVehicles([{ id: 7 }]);
  setHistory({ data: [makeSnapshot(T3, { di_torque: 100, di_stator_temp: 40 })] });
});

// ── Vehicle resolution & hook contract ──────────────────────────────────────────

describe('MotorHistoryWidget — vehicle resolution & hook contract', () => {
  it('passes the vehicleId prop and a 200-row limit to useMotorHistory', () => {
    setVehicles([{ id: 7 }, { id: 9 }]);
    renderWidget({ cols: 2, rows: 2 }, 9);

    expect(hooks.motor).toHaveBeenCalledWith(9, 200);
  });

  it('falls back to the first vehicle id when no vehicleId prop is provided', () => {
    setVehicles([{ id: 42 }]);
    renderWidget({ cols: 2, rows: 2 }, undefined);

    expect(hooks.motor).toHaveBeenCalledWith(42, 200);
  });

  it('falls back to id 0 (query disabled) when no vehicles are available', () => {
    setVehicles([]);
    renderWidget({ cols: 2, rows: 2 }, undefined);

    expect(hooks.motor).toHaveBeenCalledWith(0, 200);
  });
});

// ── Chart-data derivation (buildChartData) ───────────────────────────────────────

describe('MotorHistoryWidget — chart-data derivation', () => {
  it('maps torque/gear and sorts snapshots ascending by time', () => {
    setHistory({
      data: [
        makeSnapshot(T3, { di_torque: 310, gear: 'D' }),
        makeSnapshot(T1, { di_torque: 250, shift_state: 'P' }),
      ],
    });
    renderWidget();

    const rows = chartRows();
    expect(rows.map((r) => r.time)).toEqual([T1, T3]);
    expect(rows[0].torque).toBe(250);
    // gear falls back to shift_state when `gear` is absent.
    expect(rows[0].gear).toBe('P');
    expect(rows[1].gear).toBe('D');
  });

  it('preserves a zero torque and coalesces a missing torque to null', () => {
    setHistory({
      data: [makeSnapshot(T1, { di_torque: 0 }), makeSnapshot(T2, { di_torque: null })],
    });
    renderWidget();

    const rows = chartRows();
    expect(rows[0].torque).toBe(0);
    expect(rows[1].torque).toBeNull();
  });

  it('prefers di_stator_temp, falls back to motor_temp_c_front, else null', () => {
    setHistory({
      data: [
        makeSnapshot(T1, { di_stator_temp: 55, motor_temp_c_front: 30 }),
        makeSnapshot(T2, { di_stator_temp: null, motor_temp_c_front: 42 }),
        makeSnapshot(T3, { di_stator_temp: null, motor_temp_c_front: null }),
      ],
    });
    renderWidget();

    const rows = chartRows();
    expect(rows[0].statorTemp).toBe(55); // di_stator_temp wins (°C passthrough)
    expect(rows[1].statorTemp).toBe(42); // fallback to motor_temp_c_front
    expect(rows[2].statorTemp).toBeNull(); // both absent
  });

  it('reads the loosely-typed lateral/longitudinal G overlays from the raw snapshot', () => {
    setHistory({
      data: [makeSnapshot(T1, { lateral_accel: 0.35, longitudinal_accel: -0.2 })],
    });
    renderWidget();

    const [row] = chartRows();
    expect(row.lateralG).toBe(0.35);
    expect(row.longitudinalG).toBe(-0.2);
  });

  it('defaults the G overlays to null when the fields are absent', () => {
    setHistory({ data: [makeSnapshot(T1, { di_torque: 12 })] });
    renderWidget();

    const [row] = chartRows();
    expect(row.lateralG).toBeNull();
    expect(row.longitudinalG).toBeNull();
  });

  it('drops snapshots lacking both ts and created_at and uses created_at when ts is empty', () => {
    setHistory({
      data: [
        makeSnapshot(T1, { ts: '', created_at: T1, di_torque: 5 }),
        makeSnapshot('', { ts: '', created_at: '', di_torque: 9 }),
      ],
    });
    renderWidget();

    const rows = chartRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].time).toBe(T1);
    expect(rows[0].torque).toBe(5);
  });
});

// ── Unit boundary (°F conversion) ────────────────────────────────────────────────

describe('MotorHistoryWidget — temperature unit boundary', () => {
  it('leaves the stator trace, threshold, domain and band untouched in °C', () => {
    setHistory({ data: [makeSnapshot(T1, { di_stator_temp: 40 })] });
    renderWidget();

    expect(chartRows()[0].statorTemp).toBe(40);
    // danger 100 °C, tempMax = ceil(100 + 20) = 120.
    expect(tempAxis()?.domain).toEqual([0, 120]);
    expect(cap.refArea[0].y1).toBe(100);
    expect(cap.refArea[0].y2).toBe(120);
  });

  it('converts the trace, threshold, domain and band to °F', () => {
    unitState.temperature = '°F';
    setHistory({ data: [makeSnapshot(T1, { di_stator_temp: 45 })] });
    renderWidget({ cols: 3, rows: 2 });

    // 45 °C → 113 °F.
    expect(chartRows()[0].statorTemp).toBe(113);
    // danger 100 °C → 212 °F; tempMax = ceil(212 + 20) = 232.
    expect(tempAxis()?.domain).toEqual([0, 232]);
    expect(cap.refArea[0].y1).toBe(212);
    expect(cap.refArea[0].y2).toBe(232);
    // The right axis carries the active unit as its label (wide mode).
    expect(tempAxis()?.label?.value).toBe('°F');
  });

  it('expands the temp domain to the hottest reading above the danger band', () => {
    setHistory({ data: [makeSnapshot(T1, { di_stator_temp: 150 })] });
    renderWidget();

    // statorTemp 150 > (100 + 20) base → tempMax = ceil(150) = 150.
    expect(tempAxis()?.domain).toEqual([0, 150]);
    expect(cap.refArea[0].y2).toBe(150);
  });
});

// ── Summary stats ────────────────────────────────────────────────────────────────

describe('MotorHistoryWidget — summary stats', () => {
  it('shows the latest non-null torque and stator with their units (skipping trailing nulls)', () => {
    unitState.temperature = '°C';
    setHistory({
      data: [
        makeSnapshot(T1, { di_torque: 250, di_stator_temp: 40 }),
        makeSnapshot(T2, { di_torque: 310, di_stator_temp: 42 }),
        makeSnapshot(T3, { di_torque: null, di_stator_temp: 45 }),
      ],
    });
    const { container } = renderWidget();

    expect(screen.getByText('Torque')).toBeInTheDocument();
    expect(screen.getByText('Stator')).toBeInTheDocument();
    // Latest non-null torque is T2's 310 (T3's null is skipped).
    expect(container).toHaveTextContent('310Nm');
    // Latest stator is T3's 45 °C.
    expect(container).toHaveTextContent('45°C');
  });

  it('renders an em-dash placeholder when the latest values are null but a row exists', () => {
    setHistory({ data: [makeSnapshot(T1, { di_torque: null, di_stator_temp: null })] });
    const { container } = renderWidget();

    expect(screen.getByText('Torque')).toBeInTheDocument();
    expect(container).toHaveTextContent('—Nm');
    expect(container).toHaveTextContent('—°C');
  });
});

// ── Loading, empty & error ───────────────────────────────────────────────────────

describe('MotorHistoryWidget — loading, empty & error states', () => {
  it('renders only a skeleton (no chart, no empty state) while loading', () => {
    setHistory({ isLoading: true, data: undefined });
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('composed-chart')).toBeNull();
    expect(screen.queryByText('No motor history')).toBeNull();
  });

  it('shows the "No motor history" empty state (never a blank panel) when there are no rows', () => {
    setHistory({ data: [] });
    renderWidget();

    expect(screen.getByRole('status')).toHaveTextContent('No motor history');
    expect(screen.queryByTestId('composed-chart')).toBeNull();
  });

  it('degrades to the empty state (without crashing) when the query errors with no data', () => {
    setHistory({ isError: true, data: [] });

    expect(() => renderWidget()).not.toThrow();
    expect(screen.getByText('No motor history')).toBeInTheDocument();
  });
});

// ── Sizing ───────────────────────────────────────────────────────────────────────

describe('MotorHistoryWidget — sizing', () => {
  it('hides the chart but keeps the stats in the compact (1-col) layout', () => {
    setHistory({ data: [makeSnapshot(T1, { di_torque: 88 })] });
    renderWidget({ cols: 1, rows: 2 });

    expect(screen.queryByTestId('composed-chart')).toBeNull();
    expect(screen.getByText('Torque')).toBeInTheDocument();
  });

  it('draws only the torque and stator lines in the normal (2-col) layout', () => {
    renderWidget({ cols: 2, rows: 2 });

    expect(lineKeys()).toEqual(['torque', 'statorTemp']);
    expect(screen.queryByTestId('line-lateralG')).toBeNull();
    // No axis labels in the compact-height (non-wide) layout.
    expect(torqueAxis()?.label).toBeUndefined();
    expect(tempAxis()?.label).toBeUndefined();
  });

  it('adds the lateral/longitudinal G overlays and axis labels in the wide (≥3-col) layout', () => {
    renderWidget({ cols: 3, rows: 2 });

    expect(lineKeys()).toEqual(['torque', 'statorTemp', 'lateralG', 'longitudinalG']);
    expect(screen.getByTestId('line-lateralG')).toBeInTheDocument();
    expect(torqueAxis()?.label?.value).toBe('Nm');
    expect(tempAxis()?.label?.value).toBe('°C');
  });
});

// ── Axis / tooltip / reference wiring ────────────────────────────────────────────

describe('MotorHistoryWidget — axis, tooltip & reference wiring', () => {
  it('binds the x-axis to time and formats ticks through formatDateTime', () => {
    renderWidget();

    const x = cap.xaxis.at(-1);
    expect(x?.dataKey).toBe('time');
    expect(x?.tickFormatter?.(T1)).toBe(`@${T1}`);
  });

  it('formats the torque and temperature axis ticks', () => {
    renderWidget();

    expect(torqueAxis()?.tickFormatter?.(250)).toBe('250');
    expect(tempAxis()?.tickFormatter?.(120)).toBe('120°');
    expect(tempAxis()?.orientation).toBe('right');
  });

  it('paints the danger band from the threshold to tempMax on the temp axis', () => {
    renderWidget();

    const band = cap.refArea[0];
    expect(band.yAxisId).toBe('temp');
    expect(band.y1).toBe(100);
    expect(band.y2).toBe(120);
    expect(band.fill).toBe('#ef4444');
  });

  it('formats each tooltip series with its unit and localises the label', () => {
    renderWidget();
    const fmt = cap.tooltip.at(-1)?.formatter;
    const labelFmt = cap.tooltip.at(-1)?.labelFormatter;

    expect(fmt?.(250, 'torque')).toEqual(['250 Nm', 'Torque']);
    expect(fmt?.(45, 'statorTemp')).toEqual(['45°C', 'Stator']);
    expect(fmt?.(0.35, 'lateralG')).toEqual(['0.35 g', 'Lateral G']);
    expect(fmt?.(-0.2, 'longitudinalG')).toEqual(['-0.20 g', 'Long. G']);
    // Unknown series fall through to the raw value + name.
    expect(fmt?.(5, 'mystery')).toEqual(['5', 'mystery']);
    expect(labelFmt?.(T2)).toBe(`@${T2}`);
  });

  it('binds the torque and stator line colours', () => {
    renderWidget();

    expect(cap.lines.find((l) => l.dataKey === 'torque')?.stroke).toBe('#06b6d4');
    expect(cap.lines.find((l) => l.dataKey === 'statorTemp')?.stroke).toBe('#f97316');
  });
});

// ── Interactions & accessibility ─────────────────────────────────────────────────

describe('MotorHistoryWidget — interactions & a11y', () => {
  it('invokes refetch when the accessible refresh chip is activated', () => {
    const q = setHistory({ data: [makeSnapshot(T1, { di_torque: 10 })] });
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes from the compact layout as well', () => {
    const q = setHistory({ data: [makeSnapshot(T1, { di_torque: 10 })] });
    renderWidget({ cols: 1, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('exposes the widget title as a heading in the non-compact layout', () => {
    renderWidget();

    expect(screen.getByRole('heading', { name: /Motor History/i })).toBeInTheDocument();
  });
});
