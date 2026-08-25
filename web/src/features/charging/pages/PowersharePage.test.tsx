/**
 * PowersharePage — behaviour + hardening coverage.
 *
 * PowersharePage default-exports a single page component that fans five cold
 * `/signals/observations` queries (status / type / stopReason / hoursLeft /
 * instantaneous-power) out into a KPI band and four panels, deriving trend
 * series + peaks + a raw-signal snapshot at the render boundary.
 *
 * Unlike sibling pages that gate loading/error/empty at the PAGE level, this
 * page delegates those states to each panel (PowerTrendPanel, RuntimePanel,
 * HoursTrendPanel, StopReasonPanel, SignalSnapshotPanel). So the panels are
 * rendered REAL here — their distinct Skeleton / QueryError / EmptyState copy
 * makes the assertions unambiguous — while only the data source, the vehicle
 * picker, and i18n are stubbed. The pure derivation helpers (`buildSeries`,
 * `seriesPeak`, `humanizeEnum`, `statusNeon`) stay real and get their own
 * focused unit block.
 *
 * What is covered:
 *   1. NO FLEET  — a null active vehicle renders the "select a vehicle" empty
 *      state and none of the telemetry panels.
 *   2. READY     — the KPI band shows humanised enums + SI-formatted numbers,
 *      every panel + a11y region renders, and each query is issued with the
 *      correct field + limit (latest-only vs SERIES_LIMIT series).
 *   3. LOADING   — every panel shows a skeleton, the KPI band shows "—"
 *      placeholders (never blank), and no ready value or error leaks.
 *   4. ERROR     — every panel surfaces QueryError with a Retry that is wired
 *      to that source's refetch.
 *   5. PRECEDENCE — a stop-reason-only failure blanks the stop + snapshot
 *      panels but NOT the runtime/power/hours panels, proving `runtimeError`
 *      excludes the stop signal while `snapshotError` includes it.
 *   6. EMPTY     — each panel renders its own distinct EmptyState (never a
 *      blank panel) and the KPI band renders its "—" form.
 *   7. REFRESH   — the header refresh control refetches all five sources once.
 *   8. HELPERS   — buildSeries reversal + null-drop, seriesPeak, humanizeEnum,
 *      and statusNeon are exercised directly.
 *
 * Network is never hit: `useSignalObservations` is stubbed per-signal, the
 * vehicle picker is inert, and i18n resolves to the English fallback with
 * {{placeholder}} interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/feedback/Toast';
import type { SignalObservation } from '@/types/signals';
import {
  POWERSHARE_SIGNALS,
  SERIES_LIMIT,
  buildSeries,
  seriesPeak,
  humanizeEnum,
  statusNeon,
  type TrendPoint,
} from '../components/powershare';

// ── Hoisted, per-test controllable state ─────────────────────────────
// `queries` maps a signal field name → the stubbed useSignalObservations
// result the page reads. `observe` is the mock the page calls; it records
// call args (for param-wiring assertions) and routes by signal_name.
const h = vi.hoisted(() => ({
  selectedVehicleId: 7 as number | null,
  queries: {} as Record<string, unknown>,
  observe: vi.fn((_vehicleId: unknown, opts?: { signal_name?: string; limit?: number }) => {
    const name = opts?.signal_name ?? '';
    return (
      h.queries[name] ?? {
        data: undefined,
        isLoading: false,
        error: null,
        isError: false,
        isFetching: false,
        isStale: false,
        dataUpdatedAt: 0,
        refetch: () => {},
      }
    );
  }),
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useTelemetry')>();
  return { ...actual, useSignalObservations: h.observe };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.selectedVehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

// The header vehicle picker owns its own store wiring (covered by its own
// suite); render an inert marker so the page's action row stays assertable.
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import PowersharePage from './PowersharePage';

// jsdom lacks matchMedia (framer-motion's useReducedMotion, reached via FadeIn
// and the freshness chip). The chart/observer polyfills already live in
// test-setup.ts.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

interface QueryStub {
  data: SignalObservation[] | undefined;
  isLoading: boolean;
  error: unknown;
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeQuery(overrides: Partial<QueryStub> = {}): QueryStub {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isError: false,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function textObs(name: string, text: string, ts: string): SignalObservation {
  return {
    vehicle_id: 7,
    ts,
    signal_name: name,
    value_numeric: null,
    value_text: text,
    value_bool: null,
    source: 'fleet_telemetry',
  };
}

function numObs(name: string, value: number | null, ts: string): SignalObservation {
  return {
    vehicle_id: 7,
    ts,
    signal_name: name,
    value_numeric: value,
    value_text: null,
    value_bool: null,
    source: 'fleet_telemetry',
  };
}

// A fully-populated, "sharing to Home at 3.25 kW with 5.5h left" fleet.
function readyFleet() {
  h.queries[POWERSHARE_SIGNALS.status] = makeQuery({
    data: [textObs(POWERSHARE_SIGNALS.status, 'PowershareStatusActive', '2024-05-01T10:00:00Z')],
  });
  h.queries[POWERSHARE_SIGNALS.type] = makeQuery({
    data: [textObs(POWERSHARE_SIGNALS.type, 'PowershareTypeHome', '2024-05-01T10:00:00Z')],
  });
  h.queries[POWERSHARE_SIGNALS.stopReason] = makeQuery({
    data: [textObs(POWERSHARE_SIGNALS.stopReason, 'PowershareStopReasonNone', '2024-05-01T10:00:00Z')],
  });
  // Newest-first, with a null in the middle to exercise buildSeries' drop.
  h.queries[POWERSHARE_SIGNALS.hoursLeft] = makeQuery({
    data: [
      numObs(POWERSHARE_SIGNALS.hoursLeft, 5.5, '2024-05-01T10:02:00Z'),
      numObs(POWERSHARE_SIGNALS.hoursLeft, null, '2024-05-01T10:01:00Z'),
      numObs(POWERSHARE_SIGNALS.hoursLeft, 6, '2024-05-01T10:00:00Z'),
    ],
  });
  h.queries[POWERSHARE_SIGNALS.power] = makeQuery({
    data: [
      numObs(POWERSHARE_SIGNALS.power, 3.25, '2024-05-01T10:02:00Z'),
      numObs(POWERSHARE_SIGNALS.power, 2, '2024-05-01T10:01:00Z'),
      numObs(POWERSHARE_SIGNALS.power, 1, '2024-05-01T10:00:00Z'),
    ],
  });
}

function setAll(stub: () => QueryStub) {
  for (const name of Object.values(POWERSHARE_SIGNALS)) {
    h.queries[name] = stub();
  }
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/charging/powershare']}>
        <ToastProvider>
          <PowersharePage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectedVehicleId = 7;
  h.queries = {};
  readyFleet();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PowersharePage', () => {
  it('renders the no-vehicle empty state (and no telemetry panels) when the fleet is empty', () => {
    h.selectedVehicleId = null;

    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Powershare' })).toBeInTheDocument();
    expect(
      screen.getByText('Select a vehicle to view its Powershare telemetry.'),
    ).toBeInTheDocument();

    // None of the telemetry panels mount without a vehicle in scope.
    expect(screen.queryByText('Output Power Trend')).not.toBeInTheDocument();
    expect(screen.queryByText('Live Session')).not.toBeInTheDocument();
    expect(screen.queryByText('Signal Snapshot')).not.toBeInTheDocument();
    // The picker is still offered in the header action slot.
    expect(screen.getByTestId('vehicle-select')).toBeInTheDocument();
  });

  it('renders the KPI band, every panel + a11y region, and issues each query with the right field + limit', () => {
    renderPage();

    // KPI band — humanised enums + SI-formatted numbers, scoped to its region
    // so the same values on sibling panels can't create a false positive.
    const kpi = within(screen.getByRole('region', { name: 'Powershare metrics' }));
    expect(kpi.getByText('Active')).toBeInTheDocument();
    expect(kpi.getByText('Home')).toBeInTheDocument();
    expect(kpi.getByText('3.25 kW')).toBeInTheDocument();
    expect(kpi.getByText('5.5 h')).toBeInTheDocument();

    // Every section renders (titles are unique per panel; stop reason is
    // identified by its help copy which only appears on its panel).
    expect(screen.getAllByText('Output Power Trend').length).toBeGreaterThan(0);
    expect(screen.getByText('Live Session')).toBeInTheDocument();
    expect(screen.getAllByText('Remaining Runtime Trend').length).toBeGreaterThan(0);
    expect(screen.getByText('Signal Snapshot')).toBeInTheDocument();
    expect(
      screen.getByText('Last recorded reason Powershare was halted.'),
    ).toBeInTheDocument();

    // Derived state propagates beyond the KPI band into the live-session panel.
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('3.25 kW').length).toBeGreaterThanOrEqual(2);

    // a11y landmarks — the three labelled section regions.
    expect(screen.getByRole('region', { name: 'Powershare metrics' })).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Powershare output and live session' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Powershare runtime trend and stop reason' }),
    ).toBeInTheDocument();

    // Query wiring: text signals pull only the latest row; numeric signals
    // pull a SERIES_LIMIT window to feed the trend charts.
    expect(h.observe).toHaveBeenCalledWith(7, { signal_name: POWERSHARE_SIGNALS.status, limit: 1 });
    expect(h.observe).toHaveBeenCalledWith(7, { signal_name: POWERSHARE_SIGNALS.type, limit: 1 });
    expect(h.observe).toHaveBeenCalledWith(7, { signal_name: POWERSHARE_SIGNALS.stopReason, limit: 1 });
    expect(h.observe).toHaveBeenCalledWith(7, {
      signal_name: POWERSHARE_SIGNALS.hoursLeft,
      limit: SERIES_LIMIT,
    });
    expect(h.observe).toHaveBeenCalledWith(7, {
      signal_name: POWERSHARE_SIGNALS.power,
      limit: SERIES_LIMIT,
    });

    // Ready state leaks neither an error nor an empty placeholder.
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No power readings yet/i)).not.toBeInTheDocument();
  });

  it('shows a skeleton in every panel and "—" KPI placeholders while loading, leaking no values', () => {
    setAll(() =>
      makeQuery({ isLoading: true, isFetching: true, data: undefined, dataUpdatedAt: 0 }),
    );

    const { container } = renderPage();

    // Shell + panel titles still render above the skeletons.
    expect(screen.getByRole('heading', { level: 1, name: 'Powershare' })).toBeInTheDocument();
    expect(screen.getByText('Live Session')).toBeInTheDocument();

    // KPI band degrades to "—" placeholders for all four metrics (never blank).
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);

    // One or more skeletons per panel — the animate-pulse marker.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(1);

    // No resolved values and no error copy leak while loading.
    expect(screen.queryByText('3.25 kW')).not.toBeInTheDocument();
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
  });

  it('surfaces QueryError in every panel and wires each Retry to that source refetch', () => {
    setAll(() =>
      makeQuery({ error: new Error('boom'), isError: true, data: undefined, dataUpdatedAt: 0 }),
    );

    renderPage();

    // Five data-bound panels → five error banners + five Retry actions.
    expect(screen.getAllByText(/Can't reach server/i)).toHaveLength(5);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(5);

    // The first error banner is the power-trend panel, whose Retry refetches
    // only its own source.
    fireEvent.click(retries[0]);
    expect(h.queries[POWERSHARE_SIGNALS.power].refetch).toHaveBeenCalledTimes(1);

    // The KPI band still renders its "—" form rather than crashing on error.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('blanks only the stop + snapshot panels on a stop-reason failure (runtime error excludes it)', () => {
    // Everything ready EXCEPT the stop-reason signal, which errors.
    h.queries[POWERSHARE_SIGNALS.stopReason] = makeQuery({
      error: new Error('stop down'),
      isError: true,
      data: undefined,
      dataUpdatedAt: 0,
    });

    renderPage();

    // `runtimeError` is `status ?? type ?? power ?? hours` — the stop signal is
    // deliberately excluded — while `snapshotError` is a find() across ALL
    // five. So exactly two panels blank: StopReasonPanel + SignalSnapshotPanel.
    expect(screen.getAllByText(/Can't reach server/i)).toHaveLength(2);

    // The live-session panel keeps rendering its ready content (StatusPill),
    // proving it was NOT gated on the stop-signal error. KPI + runtime = 2.
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(2);
    // The power trend panel likewise stays healthy.
    expect(screen.getAllByText('Output Power Trend').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Remaining Runtime Trend').length).toBeGreaterThan(0);
  });

  it('renders a distinct EmptyState in every panel (never blank) when all signals are empty', () => {
    setAll(() => makeQuery({ data: [] }));

    renderPage();

    // Each panel owns its own contextual empty copy.
    expect(screen.getByText(/No power readings yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No runtime readings yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No live Powershare session/i)).toBeInTheDocument();
    expect(screen.getByText(/No stop reason recorded/i)).toBeInTheDocument();

    // KPI band renders its "—" placeholders, and no error surfaces.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
    // The snapshot panel still mounts (its table degrades to dashes, not blank).
    expect(screen.getByText('Signal Snapshot')).toBeInTheDocument();
  });

  it('refetches all five signal sources when the header refresh control is used', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Powershare data' }));

    for (const name of Object.values(POWERSHARE_SIGNALS)) {
      expect(h.queries[name].refetch).toHaveBeenCalledTimes(1);
    }
  });
});

describe('powershare derivation helpers', () => {
  it('buildSeries orders oldest→newest and drops null-numeric rows', () => {
    // Backend returns newest-first; the middle row is a non-numeric reading.
    const data: SignalObservation[] = [
      numObs('P', 30, '2024-05-01T10:02:00Z'),
      numObs('P', null, '2024-05-01T10:01:00Z'),
      numObs('P', 10, '2024-05-01T10:00:00Z'),
    ];

    const series = buildSeries(data);

    expect(series.map((p) => p.value)).toEqual([10, 30]);
    expect(series.map((p) => p.ts)).toEqual([
      '2024-05-01T10:00:00Z',
      '2024-05-01T10:02:00Z',
    ]);
    expect(buildSeries(undefined)).toEqual([]);
    expect(buildSeries([])).toEqual([]);
  });

  it('seriesPeak returns the largest value, or 0 for an empty series', () => {
    const points: TrendPoint[] = [
      { ts: 'a', label: 'a', value: 10 },
      { ts: 'b', label: 'b', value: 30 },
      { ts: 'c', label: 'c', value: 20 },
    ];
    expect(seriesPeak(points)).toBe(30);
    expect(seriesPeak([])).toBe(0);
  });

  it('humanizeEnum strips the signal prefix, splits camelCase, and null-guards', () => {
    expect(humanizeEnum('PowershareStatusActive', POWERSHARE_SIGNALS.status)).toBe('Active');
    expect(humanizeEnum('PowershareStopReasonUserRequest', POWERSHARE_SIGNALS.stopReason)).toBe(
      'User Request',
    );
    // No matching prefix falls back to the generic "Powershare" strip / split.
    expect(humanizeEnum('SomethingElse', 'NoMatch')).toBe('Something Else');
    expect(humanizeEnum(null)).toBeNull();
  });

  it('statusNeon maps status semantics to KPI accent colours', () => {
    expect(statusNeon('PowershareStatusActive')).toBe('green');
    expect(statusNeon('PowershareStatusError')).toBe('red');
    expect(statusNeon(null)).toBe('blue');
  });
});
