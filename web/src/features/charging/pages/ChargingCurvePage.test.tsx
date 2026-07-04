/**
 * ChargingCurvePage — behaviour + hardening coverage.
 *
 * ChargingCurvePage default-exports a single page component that
 * orchestrates a KPI band, a per-session inspector (selector + power
 * curve + detail panel), a session-comparison chart, a charger-type +
 * speed-trend bento, and a time-to-charge section. The heavy chart
 * sub-components live in `../components/charging-curve` and have their
 * own concerns, so they are stubbed here to lightweight prop-echoing
 * markers — this file asserts the PAGE's orchestration: what data it
 * derives, which panels it renders, how it gates loading / error /
 * empty, and how the session selection wires up. The pure helpers
 * (`sessionLabel`, `generateChargingCurve`) stay REAL so the derived
 * option labels and curve length are exercised end-to-end.
 *
 * What is covered:
 *   1. READY   — the KPI band receives the correct derived SummaryStats,
 *      every section renders with the full session list, the selector
 *      exposes one option per session (real `sessionLabel`), and the
 *      opt-in AI narrators receive the active vehicle id.
 *   2. INSPECT — selecting a session swaps the hint for the real power
 *      curve (61 points from the real `generateChargingCurve`) plus the
 *      detail panel, and surfaces the session's place caption.
 *   3. RANGE   — committing a new range through the RangePicker resets
 *      the inspected session back to the hint (regression guard).
 *   4. VEHICLE — switching the active vehicle also clears the inspected
 *      session so the <Select> never strands on an absent option
 *      (the bug the reset effect fixes).
 *   5. LOADING — every panel shows a skeleton and no ready values leak.
 *   6. ERROR   — EVERY section, INCLUDING the KPI band, surfaces
 *      QueryError (the band previously leaked an all-zero KPI grid on
 *      error) and the Retry action is wired to the query's refetch.
 *   7. EMPTY   — each section shows its own EmptyState (never a blank
 *      panel), the selector is disabled, and the KPI band renders its
 *      empty (null-stats) form rather than being hidden.
 *   8. NO FLEET — a null active vehicle threads no id to the AI narrators.
 *
 * Network is never hit: the data hook, vehicle picker, chart
 * sub-components, form controls, and AI surfaces are all stubbed. i18n
 * is stubbed so visible copy is the English fallback with
 * {{placeholder}} interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/feedback/Toast';
import type { ChargingSession } from '@/api/types';
import type { SummaryStats, CurvePoint } from '../components/charging-curve/types';

// ── Hoisted, per-test controllable state ─────────────────────────────
// `query` feeds the stubbed useChargingSessionsPaginated; `selected`
// feeds useSelectedVehicle (a single test can flip the active vehicle).
const h = vi.hoisted(() => ({
  query: undefined as unknown,
  selected: { vehicleId: 7 as number | null },
}));

const refetchMock = vi.fn();

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

vi.mock('@/api/hooks/useCharging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useCharging')>();
  return { ...actual, useChargingSessionsPaginated: () => h.query };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.selected.vehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

// Heavy chart sub-components echo the props the page threads into them so
// the page's derivations (stats, sessions, curveData, selectedSession)
// stay assertable without rendering recharts.
vi.mock('../components/charging-curve', () => ({
  SummaryStatsGrid: ({ stats, loading }: { stats: SummaryStats | null; loading?: boolean }) => (
    <div
      data-testid="summary-stats"
      data-loading={String(!!loading)}
      data-empty={String(stats == null)}
      data-total-sessions={stats?.totalSessions ?? ''}
      data-total-energy={stats?.totalEnergy ?? ''}
      data-avg-rate={stats?.avgRate ?? ''}
      data-peak-rate={stats?.peakRate ?? ''}
      data-avg-duration={stats?.avgDuration ?? ''}
      data-total-cost={stats?.totalCost ?? ''}
    />
  ),
  SessionCurveChart: ({ curveData }: { curveData: CurvePoint[] }) => (
    <div data-testid="session-curve" data-points={curveData.length} />
  ),
  SessionDetailPanel: ({ session }: { session: ChargingSession }) => (
    <div data-testid="session-detail" data-session-id={session.id} />
  ),
  SessionComparisonChart: ({ sessions }: { sessions: ChargingSession[] }) => (
    <div data-testid="comparison-chart" data-count={sessions.length} />
  ),
  ChargerTypeChart: ({ sessions }: { sessions: ChargingSession[] }) => (
    <div data-testid="charger-type-chart" data-count={sessions.length} />
  ),
  SpeedTrendChart: ({ sessions }: { sessions: ChargingSession[] }) => (
    <div data-testid="speed-trend-chart" data-count={sessions.length} />
  ),
  TimeToChargeSection: ({ sessions }: { sessions: ChargingSession[] }) => (
    <div data-testid="ttc-section" data-count={sessions.length} />
  ),
}));

// The two AI narrators are gated by withAiFeature (their own suites cover
// the AI-off/on contracts). Stub them to prove the page threads the active
// vehicle id — and only that.
vi.mock('@/components/ai/AIChargingCurveFingerprintClustering', () => ({
  AIChargingCurveFingerprintClustering: ({ vehicleId }: { vehicleId?: number }) => (
    <div data-testid="ai-fingerprint" data-vehicle-id={vehicleId ?? ''} />
  ),
}));

vi.mock('@/components/ai/AIMLChargingCurveClustering', () => ({
  AIMLChargingCurveClustering: ({ vehicleId }: { vehicleId?: number }) => (
    <div data-testid="ai-mlcluster" data-vehicle-id={vehicleId ?? ''} />
  ),
}));

// RangePicker → a single button that commits a fixed new range; VehicleSelect
// → an inert marker. The page owns the reset-on-range-change wiring; the
// picker's own calendar behaviour is out of scope here.
vi.mock('@/components/forms', () => ({
  RangePicker: ({
    value,
    onChange,
    triggerTestId,
  }: {
    value: { start: string; end: string };
    onChange: (r: { start: string; end: string }) => void;
    triggerTestId?: string;
    align?: string;
  }) => (
    <button
      type="button"
      data-testid={triggerTestId ?? 'range-picker'}
      data-start={value.start}
      data-end={value.end}
      onClick={() => onChange({ start: '2099-01-01', end: '2099-01-31' })}
    >
      change range
    </button>
  ),
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import ChargingCurvePage from './ChargingCurvePage';

// jsdom lacks matchMedia (framer-motion's useReducedMotion via FadeIn).
// The chart/observer polyfills already live in test-setup.ts.
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
  data: ChargingSession[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeQuery(overrides: Partial<QueryStub> = {}): QueryStub {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: refetchMock,
    ...overrides,
  };
}

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  const started_at = overrides.started_at ?? '2024-05-01T10:00:00Z';
  return {
    id: 101,
    vehicle_id: 7,
    started_at,
    ended_at: '2024-05-01T10:40:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 50_000,
    peak_power_w: 150_000,
    avg_power_w: 120_000,
    cost_decimal: 12.5,
    cost_currency: 'USD',
    charger_type: 'Tesla',
    cable_type: null,
    live: false,
    startedAt: started_at,
    duration_min: 40,
    ...overrides,
  };
}

// Supercharger (DC) — 40 min, 20→80%, 50 kWh, 150 kW peak, $12.50.
const dcSession = makeSession({ id: 101, start_place: 'Downtown Plaza' });
// Home / AC — 360 min, 40→90%, 30 kWh, 11 kW peak, $4.25.
const acSession = makeSession({
  id: 102,
  started_at: '2024-05-02T22:00:00Z',
  ended_at: '2024-05-03T04:00:00Z',
  start_soc_pct: 40,
  end_soc_pct: 90,
  delta_soc_pct: 50,
  total_energy_added_wh: 30_000,
  peak_power_w: 11_000,
  avg_power_w: null,
  cost_decimal: 4.25,
  charger_type: null,
  start_place: null,
});

function buildTree(qc: QueryClient): ReactNode {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/charging/curve']}>
        <ToastProvider>
          <ChargingCurvePage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(buildTree(qc));
  return { ...result, qc };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selected.vehicleId = 7;
  h.query = makeQuery({ data: [dcSession, acSession] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChargingCurvePage', () => {
  it('renders the full dashboard with derived summary stats when data is ready', () => {
    renderPage();

    // Page shell.
    expect(screen.getByRole('heading', { level: 1, name: /Charging Curve/i })).toBeInTheDocument();

    // KPI band receives the deterministic derived SummaryStats.
    const stats = screen.getByTestId('summary-stats');
    expect(stats).toHaveAttribute('data-loading', 'false');
    expect(stats).toHaveAttribute('data-empty', 'false');
    expect(stats).toHaveAttribute('data-total-sessions', '2');
    expect(Number(stats.getAttribute('data-total-energy'))).toBeCloseTo(80); // (50k+30k)/1000
    expect(Number(stats.getAttribute('data-avg-rate'))).toBeCloseTo(80.5); // (150+11)/2 kW
    expect(Number(stats.getAttribute('data-peak-rate'))).toBeCloseTo(150);
    expect(Number(stats.getAttribute('data-avg-duration'))).toBeCloseTo(200); // (40+360)/2 min
    expect(Number(stats.getAttribute('data-total-cost'))).toBeCloseTo(16.75); // 12.5+4.25

    // Every downstream section renders with the full session list.
    for (const id of ['comparison-chart', 'charger-type-chart', 'speed-trend-chart', 'ttc-section']) {
      expect(screen.getByTestId(id)).toHaveAttribute('data-count', '2');
    }

    // Selector exposes the real `sessionLabel` output: placeholder + 2 sessions.
    const selector = screen.getByRole('combobox', { name: /Inspect session/i });
    expect(selector).not.toBeDisabled();
    expect(within(selector).getAllByRole('option')).toHaveLength(3);
    expect(within(selector).getByRole('option', { name: /Supercharger/ })).toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: /Home \/ AC/ })).toBeInTheDocument();

    // Nothing inspected yet → the hint shows, not a curve.
    expect(
      screen.getByText('Select a session above to view its charging curve'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('session-curve')).not.toBeInTheDocument();

    // a11y section landmarks are all labelled regions.
    expect(screen.getByRole('region', { name: 'Summary metrics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Session inspector' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Charger breakdown' })).toBeInTheDocument();

    // AI narrators are threaded with the active vehicle id.
    expect(screen.getByTestId('ai-fingerprint')).toHaveAttribute('data-vehicle-id', '7');
    expect(screen.getByTestId('ai-mlcluster')).toHaveAttribute('data-vehicle-id', '7');
  });

  it('inspects a selected session: renders its real power curve + detail panel', () => {
    renderPage();

    const selector = screen.getByRole('combobox', { name: /Inspect session/i });
    fireEvent.change(selector, { target: { value: '101' } });

    // Real generateChargingCurve(20→80% DC) yields 61 one-percent points.
    const curve = screen.getByTestId('session-curve');
    expect(curve).toHaveAttribute('data-points', '61');
    expect(screen.getByTestId('session-detail')).toHaveAttribute('data-session-id', '101');

    // The place caption appears for the inspected session.
    expect(screen.getByText(/Downtown Plaza/)).toBeInTheDocument();

    // The pre-selection hint is gone once a session is inspected.
    expect(
      screen.queryByText('Select a session above to view its charging curve'),
    ).not.toBeInTheDocument();
  });

  it('clears the inspected session when the date range changes', () => {
    renderPage();

    fireEvent.change(screen.getByRole('combobox', { name: /Inspect session/i }), {
      target: { value: '101' },
    });
    expect(screen.getByTestId('session-curve')).toBeInTheDocument();

    // Committing a new range must reset the selection back to the hint.
    fireEvent.click(screen.getByTestId('charging-curve-range'));

    expect(screen.queryByTestId('session-curve')).not.toBeInTheDocument();
    expect(
      screen.getByText('Select a session above to view its charging curve'),
    ).toBeInTheDocument();
  });

  it('clears the inspected session when the active vehicle changes', () => {
    const { rerender, qc } = renderPage();

    fireEvent.change(screen.getByRole('combobox', { name: /Inspect session/i }), {
      target: { value: '101' },
    });
    expect(screen.getByTestId('session-detail')).toHaveAttribute('data-session-id', '101');

    // Flip the active vehicle and update the SAME tree in place (same provider
    // structure → the page updates rather than remounting). The reset effect
    // must clear the selection so a globally-unique session id can't leak
    // across cars — otherwise the <Select> strands on an absent option.
    h.selected.vehicleId = 8;
    rerender(buildTree(qc));

    expect(screen.queryByTestId('session-detail')).not.toBeInTheDocument();
    expect(
      screen.getByText('Select a session above to view its charging curve'),
    ).toBeInTheDocument();
  });

  it('shows a skeleton in every panel while loading and leaks no ready values', () => {
    h.query = makeQuery({ isLoading: true, isFetching: true, data: undefined, dataUpdatedAt: 0 });

    const { container } = renderPage();

    expect(screen.getByRole('heading', { level: 1, name: /Charging Curve/i })).toBeInTheDocument();

    // KPI band stub is told it is loading and has no stats.
    const stats = screen.getByTestId('summary-stats');
    expect(stats).toHaveAttribute('data-loading', 'true');
    expect(stats).toHaveAttribute('data-empty', 'true');

    // No resolved chart sections leak while loading.
    expect(screen.queryByTestId('comparison-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('charger-type-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ttc-section')).not.toBeInTheDocument();

    // Per-section skeletons render across the page.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(5);
  });

  it('surfaces QueryError in every section including the KPI band and wires Retry to refetch', () => {
    h.query = makeQuery({ isError: true, error: new Error('boom'), data: undefined, dataUpdatedAt: 0 });

    renderPage();

    // One QueryError per data-bound section: KPI band + curve + comparison +
    // charger + speed + time-to-charge = 6. The KPI band is the regression
    // guard — it previously rendered an all-zero KPI grid on error instead.
    expect(screen.getAllByText(/Can't reach server/i)).toHaveLength(6);
    expect(screen.queryByTestId('summary-stats')).not.toBeInTheDocument();

    const retryButtons = screen.getAllByRole('button', { name: /^Retry$/i });
    expect(retryButtons).toHaveLength(6);

    fireEvent.click(retryButtons[0]);
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders a per-section EmptyState and disables the selector when there are no sessions', () => {
    h.query = makeQuery({ data: [] });

    renderPage();

    // Every data section degrades to its own EmptyState (5 total), never a
    // blank panel: curve + comparison + charger + speed + time-to-charge.
    expect(screen.getAllByText('No charging sessions to plot a curve.')).toHaveLength(5);

    // KPI band still renders (its null-stats form), and the selector is
    // disabled because there is nothing to inspect.
    const stats = screen.getByTestId('summary-stats');
    expect(stats).toHaveAttribute('data-empty', 'true');
    expect(stats).toHaveAttribute('data-loading', 'false');
    expect(screen.getByRole('combobox', { name: /Inspect session/i })).toBeDisabled();

    // No resolved chart sections and no error banner appear.
    expect(screen.queryByTestId('comparison-chart')).not.toBeInTheDocument();
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
  });

  it('threads no vehicle id to the AI narrators when the fleet is empty', () => {
    h.selected.vehicleId = null;
    h.query = makeQuery({ data: [] });

    renderPage();

    expect(screen.getByTestId('ai-fingerprint')).toHaveAttribute('data-vehicle-id', '');
    expect(screen.getByTestId('ai-mlcluster')).toHaveAttribute('data-vehicle-id', '');
    // The page shell still renders rather than crashing on a null vehicle.
    expect(screen.getByRole('heading', { level: 1, name: /Charging Curve/i })).toBeInTheDocument();
  });
});
