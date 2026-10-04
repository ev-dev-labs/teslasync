/**
 * ChargingSessionDetailWidget tests.
 *
 * The widget resolves the most-recent charging session for a vehicle and
 * renders its detail: energy added (SI Wh → kWh), duration, peak power, and a
 * classified charger badge, plus a power/SoC chart. Its behaviour surface — the
 * thing under test:
 *
 *   1. Two responsive layouts driven by `size.cols`:
 *        - compact (cols <= 1): a large kWh number + "kWh added" label + charger
 *          Badge and section title; no stat grid.
 *        - standard/wide (cols >= 2): a titled shell + a four-stat summary
 *          (Energy Added, Duration, Peak Power, Charger) + the chart.
 *   2. The derivations:
 *        - energy: `convertEnergyFromSI(total_energy_added_wh, 'kWh')`
 *        - duration: minutes → "45m" / "1h 30m" / "2h" (no dangling "0m")
 *        - peak power: `max(power_w)` across telemetry converted to kW, null-tolerant
 *        - charger classification: canonical AC/DC/Supercharger values are
 *          recognized; missing and unrecognized values remain unknown.
 *   3. The four query states every data source must handle: loading (skeleton —
 *      triggered by EITHER the detail or the telemetry query), initial error
 *      (QueryError panel, only when there is no cached detail), empty
 *      (EmptyState — never a blank panel), and data.
 *   4. Null-safety: a partial `{}` detail degrades every field to 0 / "—" rather
 *      than throwing.
 *   5. Vehicle + session resolution: explicit `vehicleId` wins, else the first
 *      vehicle; the session with the latest `startedAt` is selected and its
 *      numeric id is passed to the detail + telemetry queries; a non-numeric or
 *      absent id disables them with `null`.
 *   6. The freshness control: clicking it refetches, but only when a fetch is not
 *      already in flight.
 *   7. Graceful degradation (the hardened bug): a transient background-refetch
 *      error MUST NOT blank out otherwise-valid cached numbers — the widget keeps
 *      rendering and surfaces the failure through the freshness indicator's error
 *      state instead of the full-panel QueryError.
 *
 * `@/api/hooks/useCharging` and `@/api/hooks/useVehicles` are mocked so the
 * network is never touched and every query state is driven deterministically.
 * `react-i18next` is stubbed with a passthrough `t(key, default)` so assertions
 * read the English defaults. The shared WidgetShell / WidgetChartSummary /
 * DataFreshness / Badge / EmptyState primitives all run for real, so assertions
 * exercise the true rendered DOM. `<MemoryRouter>` wraps every render because the
 * error branch's <QueryError> uses `useNavigate`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ChargingSession as ApiChargingSession, ChargeTelemetryReading } from '@/api/types';
import type { ChargingSession } from '@/types/charging';
import ChargingSessionDetailWidget, { chargingAxisWidth } from './ChargingSessionDetailWidget';
import { camelCaseKeys } from '@/lib/resilience';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

it.each([1, 2, 3])('identifies charge session detail at %i columns', (cols) => {
  renderWidget({ cols, rows: 4 });
  expect(screen.getByRole('heading', { name: 'Charge session detail' })).toBeInTheDocument();
});

// jsdom lacks matchMedia; framer-motion's useReducedMotion (reached via
// <DataFreshness> → useMotionPreference) reads it during render. Install a
// benign stub before any component mounts.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

const {
  useChargingSessionsMock,
  useChargingSessionDetailMock,
  useChargeTelemetryMock,
  useVehiclesMock,
  axisMock,
  chartMock,
} = vi.hoisted(() => ({
  useChargingSessionsMock: vi.fn(),
  useChargingSessionDetailMock: vi.fn(),
  useChargeTelemetryMock: vi.fn(),
  useVehiclesMock: vi.fn(),
  axisMock: vi.fn(),
  chartMock: vi.fn(),
}));

vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessions: (vehicleId?: string) => useChargingSessionsMock(vehicleId),
  useChargingSessionDetail: (id: number | null) => useChargingSessionDetailMock(id),
  useChargeTelemetry: (id: number | null) => useChargeTelemetryMock(id),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual, ...chartTestDoubles,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    ComposedChart: (props: { children?: ReactNode }) => {
      chartMock(props);
      return <div>{props.children}</div>;
    },
    YAxis: (props: unknown) => { axisMock(props); return null; },
    XAxis: () => null,
    Area: () => null,
    Line: () => null,
    Tooltip: () => null,
    chartGrid: null,
    areaGradient: () => null,
  };
});

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: '10',
    startedAt: '2024-01-01T12:00:00Z',
    ...overrides,
  } as ChargingSession;
}

function makeDetail(overrides: Partial<ApiChargingSession> = {}): ApiChargingSession {
  return {
    total_energy_added_wh: 0,
    duration_min: 0,
    charger_type: null,
    ...overrides,
  } as ApiChargingSession;
}

function makeReading(overrides: Partial<ChargeTelemetryReading> = {}): ChargeTelemetryReading {
  return {
    created_at: '2024-01-01T12:00:00Z',
    power_w: 0,
    battery_level: null,
    soc: null,
    ...overrides,
  } as ChargeTelemetryReading;
}

interface DetailQuery {
  data: ApiChargingSession | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeDetailQuery(overrides: Partial<DetailQuery> = {}): DetailQuery {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function makeTelemetryQuery(
  overrides: { data?: ChargeTelemetryReading[]; isLoading?: boolean } = {},
) {
  return { data: [] as ChargeTelemetryReading[], isLoading: false, ...overrides };
}

function renderWidget(
  size: { cols: number; rows: number } = { cols: 2, rows: 2 },
  vehicleId?: number,
) {
  const view = render(
    <MemoryRouter>
      <ChargingSessionDetailWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
  expect(view.container.querySelector('h3')).toHaveAccessibleName('Charge session detail');
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (label: string) => ({ width: label.length * 6 }),
  } as unknown as CanvasRenderingContext2D);
  // Sensible defaults so a test that forgets to seed a hook still renders a
  // populated widget rather than crashing on a destructure of `undefined`.
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useChargingSessionsMock.mockReturnValue({ data: [makeSession()] });
  useChargingSessionDetailMock.mockReturnValue(makeDetailQuery({ data: makeDetail() }));
  useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});

describe('ChargingSessionDetailWidget — standard layout', () => {
  it('renders the titled shell and all four stats with formatted values', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({
        data: makeDetail({
          total_energy_added_wh: 25000,
          duration_min: 45,
          charger_type: 'Supercharger',
        }),
      }),
    );
    useChargeTelemetryMock.mockReturnValue(
      makeTelemetryQuery({
        data: [
          makeReading({ power_w: 50_000 }),
          makeReading({ power_w: 72_000 }),
          makeReading({ power_w: 60_000 }),
        ],
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Charge session detail')).toBeInTheDocument();

    // Energy Added: 25000 Wh → 25 kWh → "25.0" kWh.
    expect(screen.getByText('Energy added')).toBeInTheDocument();
    expect(screen.getByText('25.00')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();

    // Duration under an hour renders bare minutes.
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('45m')).toBeInTheDocument();

    // Peak Power is the max power_w across the telemetry series, displayed in kW.
    expect(screen.getByText('Peak power')).toBeInTheDocument();
    expect(screen.getByText('72.00')).toBeInTheDocument();
    expect(screen.getByText('kW')).toBeInTheDocument();

    // Charger label is the classified, translated value.
    expect(screen.getByText('Charger')).toBeInTheDocument();
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
  });

  it('still renders the titled shell + stats for a wide widget (cols >= 3)', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({
        data: makeDetail({ total_energy_added_wh: 10000, duration_min: 30, charger_type: 'DC' }),
      }),
    );

    renderWidget({ cols: 4, rows: 2 });

    expect(screen.getByText('Charge session detail')).toBeInTheDocument();
    expect(screen.getByText('Energy added')).toBeInTheDocument();
    expect(screen.getByText('10.00')).toBeInTheDocument();
    expect(screen.getByText('DC fast')).toBeInTheDocument();
  });
});

describe('ChargingSessionDetailWidget — duration formatting', () => {
  function renderWithDuration(mins: number) {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: makeDetail({ duration_min: mins }) }),
    );
    renderWidget({ cols: 2, rows: 2 });
  }

  it('renders bare minutes below one hour', () => {
    renderWithDuration(45);
    expect(screen.getByText('45m')).toBeInTheDocument();
  });

  it('renders hours + minutes when there is a remainder', () => {
    renderWithDuration(90);
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });

  it('renders whole hours (no dangling "0m") when evenly divisible', () => {
    renderWithDuration(120);
    expect(screen.getByText('2h')).toBeInTheDocument();
    expect(screen.queryByText('2h 0m')).not.toBeInTheDocument();
  });
});

describe('ChargingSessionDetailWidget — charger classification', () => {
  it.each([
    { chargerType: 'AC', label: 'AC / home' },
    { chargerType: 'DC', label: 'DC fast' },
    { chargerType: null, label: 'Unknown' },
  ].flatMap(source => [1, 2, 3].map(cols => ({ ...source, cols }))))(
    'uses real completed $chargerType wire classification at $cols columns',
    ({ chargerType, label, cols }) => {
      const detailWire = {
        id: 701,
        vehicle_id: 1,
        started_at: '2026-10-03T12:00:00Z',
        ended_at: '2026-10-03T12:30:00Z',
        total_energy_added_wh: 25_000,
        peak_power_w: 11_000,
        avg_power_w: 10_500,
        charger_type: chargerType,
        cable_type: 'IEC',
        live: false,
      };
      const telemetryWire = [
        { created_at: detailWire.started_at, power_w: 10_000, battery_level: 40 },
        { created_at: detailWire.ended_at, power_w: 11_000, battery_level: 45 },
      ];
      useChargingSessionsMock.mockReturnValue({ data: [makeSession({ id: '701' })] });
      useChargingSessionDetailMock.mockReturnValue(makeDetailQuery({
        data: camelCaseKeys(detailWire) as ApiChargingSession,
      }));
      useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery({
        data: camelCaseKeys(telemetryWire) as ChargeTelemetryReading[],
      }));
      renderWidget({ cols, rows: 4 });
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText('25.00')).toBeInTheDocument();
      if (chargerType !== 'DC') expect(screen.queryByText('DC fast')).not.toBeInTheDocument();
      if (chargerType !== 'AC') expect(screen.queryByText('AC / home')).not.toBeInTheDocument();
      expect(useChargingSessionDetailMock).toHaveBeenCalledWith(701);
      expect(useChargeTelemetryMock).toHaveBeenCalledWith(701);
      if (cols > 1) {
        expect(chartMock).toHaveBeenLastCalledWith(expect.objectContaining({
          data: [
            expect.objectContaining({ power: 10, soc: 40 }),
            expect.objectContaining({ power: 11, soc: 45 }),
          ],
        }));
      }
      expect(detailWire.charger_type).toBe(chargerType);
      expect(telemetryWire[0].power_w).toBe(10_000);
    },
  );

  function renderCompactWithCharger(chargerType: string | null) {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: makeDetail({ total_energy_added_wh: 1000, charger_type: chargerType }) }),
    );
    // Compact mode surfaces the charger label inside the Badge.
    renderWidget({ cols: 1, rows: 1 });
  }

  it('keeps a null charger unknown instead of inventing an AC source', () => {
    renderCompactWithCharger(null);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('AC / home')).not.toBeInTheDocument();
  });

  it('classifies a Supercharger (case-insensitive) as "Supercharger"', () => {
    renderCompactWithCharger('SUPERCHARGER');
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
    expect(screen.queryByText('DC fast')).not.toBeInTheDocument();
  });

  it('does not infer Supercharger from a Tesla-branded wall connector', () => {
    renderCompactWithCharger('Tesla Wall connector');
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Supercharger')).not.toBeInTheDocument();
  });

  it('keeps the "<invalid>" sentinel unknown rather than AC or DC', () => {
    renderCompactWithCharger('<invalid>');
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('DC fast')).not.toBeInTheDocument();
  });

  it('does not infer DC from an unclassified connector string', () => {
    renderCompactWithCharger('CCS_COMBO_2');
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('DC fast')).not.toBeInTheDocument();
  });

  it.each(['', ' ', 'unknown', 'wireless', '<invalid>'])('keeps unrecognized "%s" charger evidence unknown', value => {
    renderCompactWithCharger(value);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('AC / home')).not.toBeInTheDocument();
    expect(screen.queryByText('DC fast')).not.toBeInTheDocument();
  });
});

interface CapturedAxis {
  yAxisId: string;
  width: number;
  tickFormatter: (value: number) => string;
}

function latestAxis(id: string): CapturedAxis {
  const axes = axisMock.mock.calls.map(call => call[0] as CapturedAxis).filter(axis => axis.yAxisId === id);
  return axes[axes.length - 1];
}

describe('ChargingSessionDetailWidget — formatted axis fitting', () => {
  it('reserves measured full-label width plus tick/edge spacing without truncating labels', () => {
    const measure = vi.fn((label: string) => label === '1,234.56789000' ? 80.25 : 20);
    expect(chargingAxisWidth(['0.00', '1,234.56789000'], measure)).toBe(93);
    expect(measure).toHaveBeenCalledWith('1,234.56789000');
    expect(chargingAxisWidth([], measure)).toBe(36);
    expect(chargingAxisWidth(['١٬٢٣٤٫٥٠'], label => label.length * 7)).toBe(68);
  });

  it.each([2, 3, 4])('measures power and SOC labels in the actual %i-column chart font', cols => {
    useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery({
      data: [makeReading({ power_w: 10_000 }), makeReading({ power_w: 11_000 })],
    }));
    renderWidget({ cols, rows: 4 });
    const context = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.results[0].value as CanvasRenderingContext2D;
    expect(context.font).toMatch(new RegExp(`^${cols >= 3 ? 11 : 10}px `));
    expect(latestAxis('power').width).toBe(42);
    expect(latestAxis('soc').width).toBe(54);
    expect(latestAxis('power').tickFormatter(10.25)).toBe('10.25');
    expect(latestAxis('soc').tickFormatter(100)).toBe('100.00%');
    expect(chartMock).toHaveBeenLastCalledWith(expect.objectContaining({
      margin: { top: 4, right: 4, bottom: 0, left: 4 },
    }));
  });

  it.each([2, 3])('remeasures long localized power/SOC labels after precision changes at %i columns', cols => {
    const detail = makeDetail({ total_energy_added_wh: 25_000, charger_type: 'AC' });
    const telemetry = [makeReading({ power_w: 1_234_500, battery_level: 70 })];
    useChargingSessionDetailMock.mockReturnValue(makeDetailQuery({ data: detail }));
    useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery({ data: telemetry }));
    renderWidget({ cols, rows: 4 });
    const initialWidth = latestAxis('power').width;
    act(() => { setGlobalLocale('de-DE'); setGlobalPrecision(8); });
    const powerAxis = latestAxis('power');
    const socAxis = latestAxis('soc');
    expect(powerAxis.tickFormatter(1234.5)).toBe('1.234,50000000');
    expect(socAxis.tickFormatter(100)).toBe('100,00000000%');
    expect(powerAxis.width).toBeGreaterThanOrEqual('1.234,50000000'.length * 6 + 12);
    expect(socAxis.width).toBeGreaterThanOrEqual('100,00000000%'.length * 6 + 12);
    expect(powerAxis.width).toBeGreaterThan(initialWidth);
    expect(telemetry[0].power_w).toBe(1_234_500);
    expect(detail.total_energy_added_wh).toBe(25_000);
    expect(useChargingSessionDetailMock.mock.results[0].value.refetch).not.toHaveBeenCalled();
  });

  it('keeps the compact summary and does not mount or measure a hidden chart', () => {
    useChargingSessionDetailMock.mockReturnValue(makeDetailQuery({
      data: makeDetail({ total_energy_added_wh: 25_000, charger_type: 'AC' }),
    }));
    useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery({
      data: [makeReading({ power_w: 1_234_500 })],
    }));
    renderWidget({ cols: 1, rows: 2 });
    expect(screen.getByText('25.00')).toBeInTheDocument();
    expect(screen.getByText('AC / home')).toBeInTheDocument();
    expect(axisMock).not.toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });

  it.each([2, 3, 4])('preserves the conservative full-label fallback at %i columns when canvas is unavailable', cols => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery({
      data: [makeReading({ power_w: 1_234_500 })],
    }));
    renderWidget({ cols, rows: 4 });
    const fontSize = cols >= 3 ? 11 : 10;
    expect(latestAxis('power').width).toBeGreaterThan(36);
    expect(latestAxis('power').width).toBe(Math.ceil('1,234.50'.length * fontSize * 0.75) + 12);
    expect(latestAxis('power').tickFormatter(1234.5)).toBe('1,234.50');
    expect(latestAxis('soc').width).toBeGreaterThan(36);
    expect(latestAxis('soc').width).toBe(Math.ceil('100.00%'.length * fontSize * 0.75) + 12);
  });

  it('keeps the charging-specific 36px measured minimum with short labels', () => {
    setGlobalPrecision(0);
    useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery({
      data: [makeReading({ power_w: 1_000 })],
    }));
    renderWidget({ cols: 2, rows: 4 });
    expect(latestAxis('power').width).toBe(36);
    expect(latestAxis('power').tickFormatter(1)).toBe('1');
  });

  it('measures again when the inherited webfont becomes ready', async () => {
    const original = Object.getOwnPropertyDescriptor(document, 'fonts');
    let resolveReady = () => {};
    const ready = new Promise<void>(resolve => { resolveReady = resolve; });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } });
    const context = {
      font: '',
      measureText: vi.fn((label: string) => ({ width: label.length * 6 })),
    };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context as unknown as CanvasRenderingContext2D);
    useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery({
      data: [makeReading({ power_w: 10_000 })],
    }));
    try {
      renderWidget({ cols: 3, rows: 4 });
      const initialWidth = latestAxis('power').width;
      context.measureText.mockImplementation(label => ({ width: label.length * 8 }));
      await act(async () => { resolveReady(); await ready; });
      expect(latestAxis('power').width).toBeGreaterThan(initialWidth);
      expect(latestAxis('soc').width).toBe(68);
    } finally {
      if (original) Object.defineProperty(document, 'fonts', original);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });
});

describe('ChargingSessionDetailWidget — peak power derivation', () => {
  it('takes the maximum power_w, converts to kW and ignores null readings', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: makeDetail({ total_energy_added_wh: 1000 }) }),
    );
    useChargeTelemetryMock.mockReturnValue(
      makeTelemetryQuery({
        data: [
          makeReading({ power_w: null }),
          makeReading({ power_w: 33_300 }),
          makeReading({ power_w: 12_000 }),
        ],
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Peak power')).toBeInTheDocument();
    expect(screen.getByText('33.30')).toBeInTheDocument();
  });

  it('keeps peak power unknown when there is no telemetry', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: makeDetail({ total_energy_added_wh: 5000, duration_min: 10 }) }),
    );
    useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery({ data: [] }));

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Peak power')).toBeInTheDocument();
    // Energy "5.0" is distinct from peak "0.0", so this asserts the null-safe
    // reduce produced a numeric zero rather than NaN / a crash.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('5.00')).toBeInTheDocument();
  });
});

describe('ChargingSessionDetailWidget — compact layout', () => {
  it('identifies a big kWh number, label and charger badge without a stat grid', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({
        data: makeDetail({ total_energy_added_wh: 42000, charger_type: 'Supercharger' }),
      }),
    );

    renderWidget({ cols: 1, rows: 1 });

    // 42000 Wh → 42 kWh → "42.0".
    expect(screen.getByText('42.00')).toBeInTheDocument();
    expect(screen.getByText('kWh added')).toBeInTheDocument();
    expect(screen.getByText('Supercharger')).toBeInTheDocument();

    // Compact mode drops the titled header and the full stat grid.
    expect(screen.getByRole('heading', { name: 'Charge session detail' })).toBeInTheDocument();
    expect(screen.queryByText('Energy added')).not.toBeInTheDocument();
    expect(screen.queryByText('Peak power')).not.toBeInTheDocument();
  });

  it('shows the empty placeholder (not a blank panel) when compact and data-less', () => {
    useChargingSessionDetailMock.mockReturnValue(makeDetailQuery({ data: undefined }));

    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('No charge sessions')).toBeInTheDocument();
    expect(screen.queryByText('kWh added')).not.toBeInTheDocument();
  });
});

describe('ChargingSessionDetailWidget — query states', () => {
  it('renders a skeleton while the detail query is loading', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ isLoading: true, data: undefined }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Charge session detail')).toBeInTheDocument();
    expect(screen.queryByText('No charge sessions')).not.toBeInTheDocument();
  });

  it('keeps ready detail visible while telemetry is loading', () => {
    // Detail is ready but telemetry is still in flight — `isLoading` ORs the two
    // sources, so the whole widget must show the loading state.
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: makeDetail({ total_energy_added_wh: 1000 }) }),
    );
    useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery({ isLoading: true }));

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText('Energy added')).toBeInTheDocument();
  });

  it('renders the QueryError panel on an initial load failure (no cached detail)', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Charge session detail')).toBeInTheDocument();
    expect(screen.queryByText('Energy added')).not.toBeInTheDocument();
  });

  it('renders an EmptyState placeholder (never a blank panel) when detail is absent', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: undefined, isLoading: false, error: null, isError: false }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Titled shell still renders; the body degrades to the placeholder.
    expect(screen.getByText('Charge session detail')).toBeInTheDocument();
    expect(screen.getByText('No charge sessions')).toBeInTheDocument();
    expect(screen.queryByText('Energy added')).not.toBeInTheDocument();
  });

  it('keeps partial detail readings unknown without throwing', () => {
    // A `{}` payload is truthy, so stats render — every field falls back via the
    // widget's `?? 0` / `?? null` guards rather than crashing.
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: {} as ApiChargingSession }),
    );

    expect(() => renderWidget({ cols: 2, rows: 2 })).not.toThrow();
    expect(screen.getByText('Energy added')).toBeInTheDocument();
    expect(screen.queryByText('0m')).not.toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(3);
  });
});

describe('ChargingSessionDetailWidget — graceful degradation on transient error', () => {
  it('keeps rendering cached data and flags the freshness indicator instead of blanking out', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({
        data: makeDetail({
          total_energy_added_wh: 30000,
          duration_min: 20,
          charger_type: 'DC',
        }),
        error: new Error('transient'),
        isError: true,
        isFetching: false,
        dataUpdatedAt: Date.now(),
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // Data is still on screen …
    expect(screen.getByText('Charge session detail')).toBeInTheDocument();
    expect(screen.getByText('30.00')).toBeInTheDocument();
    expect(screen.getByText('DC fast')).toBeInTheDocument();
    // … the full-panel error is NOT shown …
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    // … and the freshness indicator is in its error state (red dot).
    expect(container.querySelector('.bg-red-400')).toBeTruthy();
  });
});

describe('ChargingSessionDetailWidget — vehicle + session resolution', () => {
  it('prefers an explicit vehicleId prop over the first vehicle', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });

    renderWidget({ cols: 2, rows: 2 }, 7);

    expect(useChargingSessionsMock).toHaveBeenCalledWith('7');
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }, { id: 7 }] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useChargingSessionsMock).toHaveBeenCalledWith('42');
  });

  it('passes undefined (disabling the sessions query) when no vehicle resolves', () => {
    useVehiclesMock.mockReturnValue({ data: [] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useChargingSessionsMock).toHaveBeenCalledWith(undefined);
  });

  it('selects the session with the latest startedAt and passes its numeric id downstream', () => {
    useChargingSessionsMock.mockReturnValue({
      data: [
        makeSession({ id: '5', startedAt: '2024-01-01T00:00:00Z' }),
        makeSession({ id: '9', startedAt: '2024-03-01T00:00:00Z' }),
        makeSession({ id: '7', startedAt: '2024-02-01T00:00:00Z' }),
      ],
    });

    renderWidget({ cols: 2, rows: 2 });

    expect(useChargingSessionDetailMock).toHaveBeenCalledWith(9);
    expect(useChargeTelemetryMock).toHaveBeenCalledWith(9);
  });

  it('passes null (disabling detail) when the latest session id is non-numeric', () => {
    useChargingSessionsMock.mockReturnValue({
      data: [makeSession({ id: 'not-a-number', startedAt: '2024-01-01T00:00:00Z' })],
    });

    renderWidget({ cols: 2, rows: 2 });

    expect(useChargingSessionDetailMock).toHaveBeenCalledWith(null);
  });

  it('passes null (disabling detail) when there are no sessions', () => {
    useChargingSessionsMock.mockReturnValue({ data: [] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useChargingSessionDetailMock).toHaveBeenCalledWith(null);
  });
});

describe('ChargingSessionDetailWidget — freshness interaction', () => {
  it('preserves signed peak power and exposes telemetry refresh failures without hiding detail', () => {
    useChargingSessionDetailMock.mockReturnValue(makeDetailQuery({
      data: makeDetail({ total_energy_added_wh: 0, duration_min: 0 }),
    }));
    useChargeTelemetryMock.mockReturnValue({
      ...makeTelemetryQuery({ data: [makeReading({ power_w: -2000 }), makeReading({ power_w: null })] }),
      isError: true,
      error: new Error('telemetry failed'),
    });
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByText('-2.00')).toBeInTheDocument();
    expect(screen.getByText('0.00')).toBeInTheDocument();
    expect(screen.getByText('0m')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });
  it('refetches when the accessible refresh control is clicked', () => {
    const refetch = vi.fn();
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({
        data: makeDetail({ total_energy_added_wh: 1000 }),
        isFetching: false,
        dataUpdatedAt: Date.now(),
        refetch,
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    const refreshControl = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshControl);

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch while a fetch is already in flight', () => {
    const refetch = vi.fn();
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({
        data: makeDetail({ total_energy_added_wh: 1000 }),
        isFetching: true,
        refetch,
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    const refreshControl = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshControl);

    expect(refetch).not.toHaveBeenCalled();
  });
});
