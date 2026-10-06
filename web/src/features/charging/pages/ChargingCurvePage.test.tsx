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
 *   1. READY   — the real KPI band renders the correct derived SI metrics,
 *      every section renders with the full session list, the selector
 *      exposes one option per session (real `sessionLabel`), and the
 *      opt-in AI narrators receive the active vehicle id.
 *   2. INSPECT — selecting a session swaps the hint for the real power
 *      curve (61 points from the real `generateChargingCurve`) plus the
 *      detail panel, and surfaces the session's place caption.
 *   3. RANGE   — committing a new range through the workspace header resets
 *      the inspected session back to the hint (regression guard).
 *   4. VEHICLE — switching the active vehicle also clears the inspected
 *      session so the <Select> never strands on an absent option
 *      (the bug the reset effect fixes).
 *   5. LOADING — every panel shows a skeleton and no ready values leak.
 *   6. ERROR   — the KPI band and six source sections surface QueryError;
 *      each Retry action is wired to the query's refetch.
 *   7. EMPTY   — each section shows its own EmptyState (never a blank
 *      panel), the selector is disabled, and the KPI band renders its
 *      known zero session count and missing measurements rather than hiding.
 *   8. NO FLEET — a null active vehicle threads no id to the AI narrators.
 *
 * Charging data, vehicle scope, chart specialists and AI surfaces are stubbed.
 * Summary metrics, shared controls and layout stay real. i18n
 * is stubbed so visible copy is the English fallback with
 * {{placeholder}} interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SHARED_RANGE_STORAGE_KEY, useRangeState } from '@/hooks/useRangeState';
import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/feedback/Toast';
import { Button } from '@/components/ui';
import type { ChargingSession } from '@/api/types';
import type { CurvePoint } from '../components/charging-curve/types';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

// ── Hoisted, per-test controllable state ─────────────────────────────
// `query` feeds the stubbed useChargingSessionsPaginated; `selected`
// feeds useSelectedVehicle (a single test can flip the active vehicle).
const h = vi.hoisted(() => ({
  query: undefined as unknown,
  selected: { vehicleId: 7 as number | null },
  queryCall: vi.fn(),
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
  return { ...actual, useChargingSessionsPaginated: (...args: unknown[]) => {
    h.queryCall(...args);
    return h.query;
  } };
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
// the page's derivations (sessions, curveData, selectedSession)
// stay assertable without rendering recharts.
vi.mock('../components/charging-curve', () => ({
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
  fetchStatus: 'idle' | 'fetching' | 'paused';
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
    fetchStatus: 'idle',
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
      <MemoryRouter initialEntries={['/charging/curves?from=2024-05-01&to=2024-05-31']}>
        <ToastProvider>
          <HeaderRangeChange />
          <ChargingCurvePage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function HeaderRangeChange() {
  const { setRange } = useRangeState();
  return (
    <Button onClick={() => setRange({ start: '2099-01-01', end: '2099-01-31' })}>
      Change header range
    </Button>
  );
}

const clients: QueryClient[] = [];
const preferences = getFormatterPreferences();
let storedRange: string | null;
const sourceTitles = [
  'Power vs SOC', 'Session Details', 'Session Comparison',
  'Charge Rate by Charger Type', 'Charging Speed Trend', 'Time-to-Charge Analysis',
];

function sourceCard(title: string) {
  const card = screen.getByRole('heading', { name: title, exact: true }).closest<HTMLElement>('[data-card]');
  if (!card) throw new Error(`Missing source card: ${title}`);
  return card;
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(qc);
  const result = render(buildTree(qc));
  return { ...result, qc };
}

beforeEach(() => {
  vi.clearAllMocks();
  storedRange = localStorage.getItem(SHARED_RANGE_STORAGE_KEY);
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  h.selected.vehicleId = 7;
  h.query = makeQuery({ data: [dcSession, acSession] });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  if (storedRange == null) localStorage.removeItem(SHARED_RANGE_STORAGE_KEY);
  else localStorage.setItem(SHARED_RANGE_STORAGE_KEY, storedRange);
  setGlobalPrecision(preferences.precision);
  setGlobalLocale(preferences.locale);
  vi.restoreAllMocks();
});

describe('ChargingCurvePage', () => {
  it('renders the full dashboard with derived summary stats when data is ready', () => {
    renderPage();

    // Page shell.
    expect(screen.getByRole('heading', { level: 1, name: /Charging Curve/i })).toBeInTheDocument();

    // The accepted summary renders real SI-backed OperationalBrief readings.
    const stats = screen.getByTestId('charging-curve-summary');
    const tiles = stats.querySelectorAll('[data-operational-metric]');
    expect(tiles).toHaveLength(6);
    const expected = [
      ['Total Sessions', '2'], ['Total Energy', '80.00 kWh'],
      ['Avg Charge Rate', '80.50 kW'], ['Peak Rate', '150.00 kW'],
      ['Avg Duration', '200 min'], ['Total Cost', '$16.75'],
    ];
    expected.forEach(([label, value], index) => {
      expect(tiles[index]).toHaveAttribute('data-value-state', 'value');
      expect(tiles[index].querySelector(':scope > div:first-child > div:first-child')).toHaveTextContent(label);
      expect(tiles[index].querySelector('[data-operational-value]')).toHaveTextContent(value);
    });
    expect(h.queryCall).toHaveBeenLastCalledWith(7, {
      limit: 200, start: '2024-05-01', end: '2024-05-31',
    });

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
      screen.getAllByText('Select a session above to view its charging curve'),
    ).toHaveLength(2);
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
    fireEvent.click(screen.getByRole('button', { name: 'Change header range' }));

    expect(screen.queryByTestId('session-curve')).not.toBeInTheDocument();
    expect(
      screen.getAllByText('Select a session above to view its charging curve'),
    ).toHaveLength(2);
    expect(h.queryCall).toHaveBeenLastCalledWith(7, {
      limit: 200, start: '2099-01-01', end: '2099-01-31',
    });
    expect(JSON.parse(localStorage.getItem(SHARED_RANGE_STORAGE_KEY)!)).toMatchObject({
      start: '2099-01-01', end: '2099-01-31',
    });
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
      screen.getAllByText('Select a session above to view its charging curve'),
    ).toHaveLength(2);
    expect(h.queryCall).toHaveBeenLastCalledWith(8, {
      limit: 200, start: '2024-05-01', end: '2024-05-31',
    });
  });

  it('shows a skeleton in every panel while loading and leaks no ready values', () => {
    h.query = makeQuery({ isLoading: true, isFetching: true, data: undefined, dataUpdatedAt: 0 });

    const { container } = renderPage();

    expect(screen.getByRole('heading', { level: 1, name: /Charging Curve/i })).toBeInTheDocument();

    const stats = screen.getByTestId('charging-curve-summary');
    expect(stats).toHaveAttribute('aria-busy', 'true');
    expect(stats.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(stats.querySelectorAll('[data-operational-value]')).toHaveLength(0);

    // No resolved chart sections leak while loading.
    expect(screen.queryByTestId('comparison-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('charger-type-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ttc-section')).not.toBeInTheDocument();

    // Per-section skeletons render across the page.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(5);
    for (const title of sourceTitles)
      expect(sourceCard(title).querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('surfaces QueryError in every section including the KPI band and wires Retry to refetch', () => {
    h.query = makeQuery({ isError: true, error: new Error('boom'), data: undefined, dataUpdatedAt: 0 });

    renderPage();

    // Summary + power + details + comparison + charger + speed + duration.
    expect(screen.getAllByText(/Can't reach server/i)).toHaveLength(7);
    expect(screen.queryByTestId('charging-curve-summary')).not.toBeInTheDocument();
    for (const title of ['Summary metrics', ...sourceTitles]) {
      expect(within(sourceCard(title)).getByText(/Can't reach server/i)).toBeInTheDocument();
    }

    const retryButtons = screen.getAllByRole('button', { name: /^Retry$/i });
    expect(retryButtons).toHaveLength(7);

    retryButtons.forEach(button => fireEvent.click(button));
    expect(refetchMock).toHaveBeenCalledTimes(7);
  });

  it('renders a per-section EmptyState and disables the selector when there are no sessions', () => {
    h.query = makeQuery({ data: [] });

    renderPage();

    // Six source shells plus the source notice, never a blank panel.
    expect(screen.getAllByText('No charging sessions to plot a curve.')).toHaveLength(7);
    expect(screen.getAllByRole('button', { name: 'Reset date range' })).toHaveLength(6);
    for (const title of sourceTitles) {
      expect(within(sourceCard(title)).getByText('No charging sessions to plot a curve.')).toBeInTheDocument();
    }

    // Zero returned sessions is known; absent measurements are not zero.
    const stats = screen.getByTestId('charging-curve-summary');
    expect(stats.querySelector('[data-operational-metric="charge.sessions:0"] [data-operational-value]'))
      .toHaveTextContent('0');
    expect(stats.querySelectorAll('[data-value-state="missing"]')).toHaveLength(5);
    expect(stats).not.toHaveAttribute('aria-busy', 'true');
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
