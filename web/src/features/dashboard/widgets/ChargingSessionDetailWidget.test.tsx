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
 *          Badge; no section title and no stat grid.
 *        - standard/wide (cols >= 2): a titled shell + a four-stat summary
 *          (Energy Added, Duration, Peak Power, Charger) + the chart.
 *   2. The derivations:
 *        - energy: `convertEnergyFromSI(total_energy_added_wh, 'kWh')`
 *        - duration: minutes → "45m" / "1h 30m" / "2h" (no dangling "0m")
 *        - peak power: `max(power_kw)` across telemetry, null-tolerant
 *        - charger classification: null/'' → AC / Home, supercharger|tesla →
 *          Supercharger, '<invalid>' → AC / Home, anything else → DC Fast
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
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ChargingSession as ApiChargingSession, ChargeTelemetryReading } from '@/api/types';
import type { ChargingSession } from '@/types/charging';
import ChargingSessionDetailWidget from './ChargingSessionDetailWidget';

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
} = vi.hoisted(() => ({
  useChargingSessionsMock: vi.fn(),
  useChargingSessionDetailMock: vi.fn(),
  useChargeTelemetryMock: vi.fn(),
  useVehiclesMock: vi.fn(),
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
    power_kw: 0,
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
  return render(
    <MemoryRouter>
      <ChargingSessionDetailWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so a test that forgets to seed a hook still renders a
  // populated widget rather than crashing on a destructure of `undefined`.
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useChargingSessionsMock.mockReturnValue({ data: [makeSession()] });
  useChargingSessionDetailMock.mockReturnValue(makeDetailQuery({ data: makeDetail() }));
  useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery());
});

afterEach(() => {
  cleanup();
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
          makeReading({ power_kw: 50 }),
          makeReading({ power_kw: 72 }),
          makeReading({ power_kw: 60 }),
        ],
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Charge Session Detail')).toBeInTheDocument();

    // Energy Added: 25000 Wh → 25 kWh → "25.0" kWh.
    expect(screen.getByText('Energy Added')).toBeInTheDocument();
    expect(screen.getByText('25.0')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();

    // Duration under an hour renders bare minutes.
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('45m')).toBeInTheDocument();

    // Peak Power is the max power_kw across the telemetry series.
    expect(screen.getByText('Peak Power')).toBeInTheDocument();
    expect(screen.getByText('72.0')).toBeInTheDocument();
    expect(screen.getByText('kW')).toBeInTheDocument();

    // Charger label is the classified, translated value.
    expect(screen.getByText('Charger')).toBeInTheDocument();
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
  });

  it('still renders the titled shell + stats for a wide widget (cols >= 3)', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({
        data: makeDetail({ total_energy_added_wh: 10000, duration_min: 30, charger_type: 'CCS' }),
      }),
    );

    renderWidget({ cols: 4, rows: 2 });

    expect(screen.getByText('Charge Session Detail')).toBeInTheDocument();
    expect(screen.getByText('Energy Added')).toBeInTheDocument();
    expect(screen.getByText('10.0')).toBeInTheDocument();
    expect(screen.getByText('DC Fast')).toBeInTheDocument();
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
  function renderCompactWithCharger(chargerType: string | null) {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: makeDetail({ total_energy_added_wh: 1000, charger_type: chargerType }) }),
    );
    // Compact mode surfaces the charger label inside the Badge.
    renderWidget({ cols: 1, rows: 1 });
  }

  it('classifies a null charger as "AC / Home"', () => {
    renderCompactWithCharger(null);
    expect(screen.getByText('AC / Home')).toBeInTheDocument();
  });

  it('classifies a Supercharger (case-insensitive) as "Supercharger"', () => {
    renderCompactWithCharger('SUPERCHARGER');
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
    expect(screen.queryByText('DC Fast')).not.toBeInTheDocument();
  });

  it('classifies a Tesla connector as "Supercharger" via the "tesla" match', () => {
    renderCompactWithCharger('Tesla Wall Connector');
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
  });

  it('classifies the "<invalid>" sentinel as "AC / Home", not "DC Fast"', () => {
    renderCompactWithCharger('<invalid>');
    expect(screen.getByText('AC / Home')).toBeInTheDocument();
    expect(screen.queryByText('DC Fast')).not.toBeInTheDocument();
  });

  it('classifies any other non-empty charger as "DC Fast"', () => {
    renderCompactWithCharger('CCS_COMBO_2');
    expect(screen.getByText('DC Fast')).toBeInTheDocument();
  });
});

describe('ChargingSessionDetailWidget — peak power derivation', () => {
  it('takes the maximum power_kw and ignores null readings', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: makeDetail({ total_energy_added_wh: 1000 }) }),
    );
    useChargeTelemetryMock.mockReturnValue(
      makeTelemetryQuery({
        data: [
          makeReading({ power_kw: null }),
          makeReading({ power_kw: 33.3 }),
          makeReading({ power_kw: 12 }),
        ],
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Peak Power')).toBeInTheDocument();
    expect(screen.getByText('33.3')).toBeInTheDocument();
  });

  it('reports 0.0 peak power when there is no telemetry', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: makeDetail({ total_energy_added_wh: 5000, duration_min: 10 }) }),
    );
    useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery({ data: [] }));

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Peak Power')).toBeInTheDocument();
    // Energy "5.0" is distinct from peak "0.0", so this asserts the null-safe
    // reduce produced a numeric zero rather than NaN / a crash.
    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getByText('5.0')).toBeInTheDocument();
  });
});

describe('ChargingSessionDetailWidget — compact layout', () => {
  it('renders a big kWh number + label + charger badge, no title or stat grid', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({
        data: makeDetail({ total_energy_added_wh: 42000, charger_type: 'Supercharger' }),
      }),
    );

    renderWidget({ cols: 1, rows: 1 });

    // 42000 Wh → 42 kWh → "42.0".
    expect(screen.getByText('42.0')).toBeInTheDocument();
    expect(screen.getByText('kWh added')).toBeInTheDocument();
    expect(screen.getByText('Supercharger')).toBeInTheDocument();

    // Compact mode drops the titled header and the full stat grid.
    expect(screen.queryByText('Charge Session Detail')).not.toBeInTheDocument();
    expect(screen.queryByText('Energy Added')).not.toBeInTheDocument();
    expect(screen.queryByText('Peak Power')).not.toBeInTheDocument();
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
    expect(screen.queryByText('Charge Session Detail')).not.toBeInTheDocument();
    expect(screen.queryByText('No charge sessions')).not.toBeInTheDocument();
  });

  it('also renders a skeleton while the telemetry query is loading', () => {
    // Detail is ready but telemetry is still in flight — `isLoading` ORs the two
    // sources, so the whole widget must show the loading state.
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: makeDetail({ total_energy_added_wh: 1000 }) }),
    );
    useChargeTelemetryMock.mockReturnValue(makeTelemetryQuery({ isLoading: true }));

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Energy Added')).not.toBeInTheDocument();
  });

  it('renders the QueryError panel on an initial load failure (no cached detail)', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Charge Session Detail')).not.toBeInTheDocument();
    expect(screen.queryByText('Energy Added')).not.toBeInTheDocument();
  });

  it('renders an EmptyState placeholder (never a blank panel) when detail is absent', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: undefined, isLoading: false, error: null, isError: false }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Titled shell still renders; the body degrades to the placeholder.
    expect(screen.getByText('Charge Session Detail')).toBeInTheDocument();
    expect(screen.getByText('No charge sessions')).toBeInTheDocument();
    expect(screen.queryByText('Energy Added')).not.toBeInTheDocument();
  });

  it('degrades a partial {} detail to zeros / "AC / Home" without throwing', () => {
    // A `{}` payload is truthy, so stats render — every field falls back via the
    // widget's `?? 0` / `?? null` guards rather than crashing.
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({ data: {} as ApiChargingSession }),
    );

    expect(() => renderWidget({ cols: 2, rows: 2 })).not.toThrow();
    expect(screen.getByText('Energy Added')).toBeInTheDocument();
    expect(screen.getByText('0m')).toBeInTheDocument();
    expect(screen.getByText('AC / Home')).toBeInTheDocument();
    expect(screen.getAllByText('0.0').length).toBeGreaterThan(0);
  });
});

describe('ChargingSessionDetailWidget — graceful degradation on transient error', () => {
  it('keeps rendering cached data and flags the freshness indicator instead of blanking out', () => {
    useChargingSessionDetailMock.mockReturnValue(
      makeDetailQuery({
        data: makeDetail({
          total_energy_added_wh: 30000,
          duration_min: 20,
          charger_type: 'CCS',
        }),
        error: new Error('transient'),
        isError: true,
        isFetching: false,
        dataUpdatedAt: Date.now(),
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // Data is still on screen …
    expect(screen.getByText('Charge Session Detail')).toBeInTheDocument();
    expect(screen.getByText('30.0')).toBeInTheDocument();
    expect(screen.getByText('DC Fast')).toBeInTheDocument();
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
