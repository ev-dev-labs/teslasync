/**
 * DigitalTwinPage — behaviour + hardening coverage.
 *
 * The page default-exports the Digital Twin dashboard plus two pure helpers
 * (`statusNeon`, `capitalize`) that are unit-tested directly. Its live data is
 * merged from three polled queries (security / vehicle-state / charging) into a
 * single twin view-model; every branch of that merge surfaces through the KPI
 * band, the live-status chips, and the four component-state panels.
 *
 * What is covered:
 *   1. READY   — the KPI band, both section regions, all five panels, the
 *      live-status badge/chips, the doors/windows/security/lights KV rows and
 *      the "last updated" caption render the merged (charging) state.
 *   2. LOADING — every component panel shows a skeleton and leaks no ready
 *      values while the security stream is still pending.
 *   3. ERROR   — each panel surfaces QueryError and the Retry action is wired
 *      to the query's refetch (failure + user-interaction path via userEvent).
 *   4. EMPTY   — each panel shows its own EmptyState (never a blank panel) and
 *      the KPIs and unreported status degrade to an em dash.
 *   5. GUARD   — an empty fleet renders the "no vehicles" EmptyState instead of
 *      the data scaffolding.
 *   6. SPINNER — while the vehicles list is loading the page shows the shell
 *      spinner and none of the data sections.
 *   7. BADGE   — the single-source status resolves charging > driving >
 *      validated state-endpoint > explicit live flag > unknown.
 *   8. HELPERS — statusNeon status→accent mapping (+ fallback) and capitalize
 *      (+ empty-string em-dash fallback).
 *
 * Network is never hit: the three data hooks, the vehicles hook, the selected
 * vehicle, and the date formatter are all stubbed. i18n is stubbed so visible
 * copy is the English fallback with {{placeholder}} interpolation applied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SecurityEvent, ChargingTelemetry } from '@/api/types';
import * as operationalBridge from '@/hooks/useOperationalMetrics';

const operationalMetricsSpy = vi.spyOn(operationalBridge, 'useOperationalMetrics');

type Veh = { id: number; display_name: string; vin: string; exterior_color: string | null };

interface QueryStub<T> {
  data: T | null | undefined;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

// ── Hoisted, per-test controllable state ─────────────────────────────
const h = vi.hoisted(() => ({
  vehicle: null as Veh | null,
  vehicles: [] as Veh[],
  vehiclesLoading: false,
  fleet: undefined as QueryStub<Veh[]> | undefined,
  statusLabels: {} as Record<string, string>,
   
  security: undefined as any,
   
  state: undefined as any,
   
  charging: undefined as any,
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
        template = h.statusLabels[key] ?? template;
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

// Deterministic, network-free date formatter (also consumed transitively by
// the page-header FreshnessDot chip).
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    opts: { locale: 'en-US', tz: 'UTC' },
    tz: 'UTC',
    locale: 'en-US',
    formatDate: () => 'DATE',
    formatDateTime: () => 'DATETIME',
    formatTime: (v: unknown) => (v == null ? '' : 'MOCK_TIME'),
    formatDateShort: () => 'DATE',
    formatDateWithDay: () => 'DATE',
    formatRelative: () => 'REL',
    formatRelativeTime: () => 'REL',
    formatRelativeDays: () => 'REL',
  }),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicle?.id ?? null,
    vehicle: h.vehicle,
    vehicles: h.vehicles,
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>();
  return {
    ...actual,
    useSettings: () => ({
      settings: { unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
        decimal_precision: 1, locale: 'en-US', currency_symbol: '$' },
      settingsUnavailable: false,
    }),
  };
});

vi.mock('@/api/hooks/useVehicles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: () => h.fleet ?? makeQuery({
      data: h.vehiclesLoading ? undefined : h.vehicles,
      isLoading: h.vehiclesLoading,
      isFetching: h.vehiclesLoading,
      fetchStatus: h.vehiclesLoading ? 'fetching' : 'idle',
      isSuccess: !h.vehiclesLoading,
    }),
    useVehicleState: () => h.state,
    useSecurityLatest: () => h.security,
    useChargingTelemetryLatest: () => h.charging,
  };
});

import DigitalTwinPage, { statusNeon, capitalize } from './DigitalTwinPage';

// framer-motion's useReducedMotion (via FadeIn / Spinner / FreshnessDot /
// VehicleTwin) reads matchMedia, which jsdom lacks. Chart/observer polyfills
// already live in test-setup.ts.
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

function makeQuery<T>(overrides: Partial<QueryStub<T>> = {}): QueryStub<T> {
  return {
    data: undefined,
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    fetchStatus: 'idle',
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function makeSecurity(o: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    vehicle_id: 7,
    ts: '2024-06-02T12:00:00Z',
    created_at: '2024-06-02T12:00:00Z',
    event_type: 'state',
    doors_open: null,
    windows_open: null,
    locked: true,
    sentry_mode: true,
    user_present: true,
    detail: null,
    source: 'test',
    // Compound door signal serialized as a JSON string (the wire shape).
    door_state:
      '{"DriverFront":true,"PassengerFront":false,"DriverRear":false,"PassengerRear":false,"TrunkFront":false,"TrunkRear":true}',
    fd_window: 'Open',
    fp_window: 'Closed',
    rd_window: 'Closed',
    rp_window: 'Closed',
    driver_seat_occupied: true,
    lights_high_beams: true,
    lights_hazards_active: false,
    lights_turn_signal: 'TurnSignalLeft',
    ...o,
  };
}

function makeCharging(o: Partial<ChargingTelemetry> = {}): ChargingTelemetry {
  return {
    vehicle_id: 7,
    ts: '2024-06-02T12:00:00Z',
    session_id: 1,
    battery_level: 55,
    battery_range_mi: null,
    charging_state: 'Charging',
    charger_voltage: 240,
    charger_actual_current: 40,
    charger_power_w: 11000,
    charger_phases: 1,
    charge_energy_added_wh: 5000,
    range_added_meters: null,
    range_added_meters_per_hour: null,
    charger_pilot_current: 40,
    scheduled_charging_at: null,
    source: 'test',
    charge_port_door_open: true,
    ...o,
  };
}

 
function makeState(stateOverrides: Record<string, unknown> = {}, live = true) {
  return {
    state: {
      vehicle_id: 7,
      state: 'charging',
      since: '2024-06-02T12:00:00Z',
      latitude: 0,
      longitude: 0,
      heading: 0,
      speed: 0,
      power: 0,
      battery_level: 55,
      rated_range: 0,
      ideal_range: 0,
      odometer: 0,
      inside_temp: 20,
      outside_temp: 15,
      is_climate_on: false,
      is_charging: true,
      charger_power: 11,
      charge_rate: 0,
      time_to_full_charge: 1,
      is_locked: true,
      sentry_mode: true,
      software_version: '2024',
      ...stateOverrides,
    },
    live,
    freshness: 'fresh' as const,
    observedAt: Date.now(),
    verifiedFields: ['state', 'speed', 'is_charging'] as const,
  };
}

function renderPage(entry = '/digital-twin') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <DigitalTwinPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Assert the KV row identified by its (unique) label contains `value`. */
function expectKv(label: string, value: string) {
  const dt = screen.getByText(label, { selector: 'dt' });
  expect(dt.parentElement).toHaveTextContent(value);
}

/** Assert the canonical metric identified by its unique context shows `value`. */
function expectKpi(subtitle: string, value: string) {
  const card = screen.getByText(subtitle).closest('[data-operational-metric]');
  if (!(card instanceof HTMLElement)) throw new Error(`Missing operational metric ${subtitle}`);
  expect(within(card).getByText(value)).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.statusLabels = {};
  h.vehicle = { id: 7, display_name: 'Model 3', vin: 'VIN7', exterior_color: 'PearlWhite' };
  h.vehicles = [h.vehicle];
  h.vehiclesLoading = false;
  h.fleet = undefined;
  h.security = makeQuery({ data: makeSecurity() });
  h.state = makeQuery({ data: makeState() });
  h.charging = makeQuery({ data: makeCharging() });
});

afterEach(() => {
  localStorage.clear();
});

describe('DigitalTwinPage', () => {
  it.each([
    ['security', 'Security & status'],
    ['state', 'Live status'],
    ['charging', 'Charging'],
  ] as const)('recovers failed, paused and missing %s independently of its neighbors', (source, label) => {
    const ready = h[source];
    const refetch = vi.fn();
    h[source] = makeQuery({ isError: true, error: new Error('source failed'), dataUpdatedAt: 0, refetch });
    const view = renderPage();
    const rerender = () => view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><DigitalTwinPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    const expectNeighbors = () => {
      expect(screen.getByRole('heading', { name: 'Component state' })).toBeInTheDocument();
      expectKv('Charging', 'Yes');
      if (source !== 'security') {
        expectKv('Driver front', 'Open');
        expectKpi('of 6 openings', '2');
      }
    };
    const retryOnlySource = (calls: number) => {
      fireEvent.click(screen.getByRole('button', { name: `Retry unavailable sources: ${label}` }));
      expect(refetch).toHaveBeenCalledTimes(calls);
      for (const neighbor of ['security', 'state', 'charging'] as const) {
        if (neighbor !== source) expect(h[neighbor].refetch).not.toHaveBeenCalled();
      }
    };

    expectNeighbors();
    expect(screen.getByTestId('twin-source-observations')).toHaveTextContent(`${label}: Source request failed`);
    retryOnlySource(1);

    h[source] = makeQuery({ isLoading: true, fetchStatus: 'paused', dataUpdatedAt: 0, refetch });
    rerender();
    expectNeighbors();
    expect(screen.getByTestId('twin-source-observations')).toHaveTextContent(`${label}: Refresh paused`);
    retryOnlySource(2);
    expect(screen.queryByRole('status', { name: 'Loading Security & status' })).not.toBeInTheDocument();

    h[source] = makeQuery({ dataUpdatedAt: 0, refetch });
    rerender();
    expectNeighbors();
    expect(screen.getByTestId('twin-source-observations')).toHaveTextContent(`${label}: No source snapshots`);
    retryOnlySource(3);

    h[source] = makeQuery({ isLoading: true, isFetching: true, fetchStatus: 'fetching', dataUpdatedAt: 0, refetch });
    rerender();
    expectNeighbors();
    expect(screen.getByTestId('twin-source-observations')).toHaveTextContent(`${label}: Loading source snapshots`);
    expect(screen.queryByRole('button', { name: `Retry unavailable sources: ${label}` })).not.toBeInTheDocument();
    expect(screen.getByTestId('digital-twin-summary')).not.toHaveAttribute('aria-busy', 'true');

    h[source] = ready;
    rerender();
    expectKv('Driver front', 'Open');
    expectKpi('of 6 openings', '2');
    expect(screen.queryByRole('button', { name: `Retry unavailable sources: ${label}` })).not.toBeInTheDocument();
    expect(screen.getByTestId('twin-source-observations')).not.toHaveTextContent('Source request failed');
  });

  it.each([
    ['security', 'Security & status'],
    ['state', 'Live status'],
    ['charging', 'Charging'],
  ] as const)('retains %s readings on refresh failure and clears recovery controls on success', (source, label) => {
    const ready = h[source];
    h[source] = { ...ready, isError: true, error: new Error('refresh failed') };
    const view = renderPage();
    expectKv('Driver front', 'Open');
    expectKv('Charging', 'Yes');
    expectKpi('of 6 openings', '2');
    fireEvent.click(screen.getByRole('button', { name: `Retry unavailable sources: ${label}` }));
    expect(ready.refetch).toHaveBeenCalledTimes(1);
    for (const neighbor of ['security', 'state', 'charging'] as const) {
      if (neighbor !== source) expect(h[neighbor].refetch).not.toHaveBeenCalled();
    }
    h[source] = ready;
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><DigitalTwinPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Retry unavailable sources: ${label}` })).not.toBeInTheDocument();
    expectKv('Driver front', 'Open');
    expectKv('Charging', 'Yes');
  });

  it('treats successful empty sources as empty, not paused, pending or failed', () => {
    h.security = makeQuery({ data: null, isSuccess: true });
    h.state = makeQuery({ data: null, isSuccess: true });
    h.charging = makeQuery({ data: null, isSuccess: true });
    renderPage();
    expect(screen.getByText('No door data available')).toBeInTheDocument();
    expect(screen.getByText('No live status available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry unavailable sources/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.queryByText('Source request failed')).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading Security & status' })).not.toBeInTheDocument();
  });

  it('qualifies historical vehicle state separately from populated latest-only security and charging', () => {
    h.state = makeQuery({ data: { ...makeState(), live: false } });
    renderPage('/digital-twin?as_of=2024-06-02T12%3A00%3A00Z');

    const observations = screen.getByTestId('twin-source-observations');
    const sources = within(observations).getAllByText(/^(Security & status|Reconstructed signal state|Charging):/);
    expect(sources).toHaveLength(3);
    expect(sources[0]).toHaveTextContent('Latest');
    expect(sources[0]).not.toHaveTextContent('Viewing data as of');
    expect(sources[1]).toHaveTextContent('Viewing data as of 2024-06-02T12:00:00Z');
    expect(sources[1]).not.toHaveTextContent('Latest');
    expect(sources[2]).toHaveTextContent('Latest');
    expect(sources[2]).not.toHaveTextContent('Viewing data as of');
    expect(screen.queryByText('Live status')).not.toBeInTheDocument();
    expect(screen.queryByText('Live overview')).not.toBeInTheDocument();
    expect(screen.queryByText('charging')).not.toBeInTheDocument();
    expect(screen.queryByText('Real-time vehicle physical state')).not.toBeInTheDocument();
    expect(screen.getByTestId('digital-twin-summary')).toHaveTextContent('Reconstructed signal state: Viewing data as of');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pick a date|date range|view settings/i })).not.toBeInTheDocument();
    expectKpi('of 6 openings', '2');
    expectKpi('of 4 windows', '1');
    expectKv('Driver front', 'Open');
    expectKv('Driver seat', 'Occupied');
    expectKv('Headlights', 'On');
    expectKv('Charging', 'Yes');
  });

  it('keeps latest-only details populated when the historical state request fails', () => {
    h.state = makeQuery({ isError: true, error: new Error('history unavailable'), dataUpdatedAt: 0 });
    renderPage('/digital-twin?as_of=2024-06-02T12%3A00%3A00Z');

    const observations = screen.getByTestId('twin-source-observations');
    expect(observations).toHaveTextContent('Reconstructed signal state: Source request failed');
    expect(observations).toHaveTextContent('Viewing data as of 2024-06-02T12:00:00Z');
    expect(observations).toHaveTextContent('Security & status: Unverified · Latest');
    expect(observations).toHaveTextContent('Charging: Unverified · Latest');
    expectKv('Driver front', 'Open');
    expectKv('Charging', 'Yes');
    expectKv('Driving', '—');
    expect(screen.queryByText('No door data available')).not.toBeInTheDocument();
  });

  it('does not treat the age of a historical observation as a stale live stream', () => {
    h.state = makeQuery({ data: {
      ...makeState(), live: false, observedAt: Date.parse('2024-06-02T11:59:00Z'),
      freshness: 'stale',
    } });
    renderPage('/digital-twin?as_of=2024-06-02T12%3A00%3A00Z');

    const observations = screen.getByTestId('twin-source-observations');
    expect(observations).toHaveTextContent('Reconstructed signal state: Source snapshots available');
    expect(observations).toHaveTextContent('Signal timestamp: MOCK_TIME');
    expect(observations).not.toHaveTextContent('Last real observation');
    expect(observations).not.toHaveTextContent('Stale');
    expectKv('Driver front', 'Open');
  });

  it.each([
    '/digital-twin?as_of=invalid',
    '/digital-twin?from=2024-06-01&to=2024-06-03',
  ])('preserves the populated latest view without a valid as-of instant: %s', (entry) => {
    renderPage(entry);

    expect(screen.getByText('Live overview')).toBeInTheDocument();
    expectKv('Charging', 'Yes');
    expect(screen.getByTestId('twin-source-observations')).not.toHaveTextContent('Viewing data as of');
    expectKpi('of 6 openings', '2');
    expectKv('Driver front', 'Open');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('localizes both status badges without changing their canonical FSM styling', () => {
    h.statusLabels = { 'digitalTwin.statusLabel.charging': 'Aufladen' };

    renderPage();

    const labels = screen.getAllByText('Aufladen', { selector: 'span' });
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.parentElement?.querySelector('[aria-hidden="true"]')).toHaveClass('bg-yellow-400');
    }
    expect(screen.queryByText('charging')).not.toBeInTheDocument();
    expectKv('Driver front', 'Open');
    expectKv('Charging', 'Yes');
    expectKpi('of 6 openings', '2');
  });

  it('renders the full dashboard, KPIs, badge/chips and every component panel when live data is ready', () => {
    renderPage();

    // Shell + a11y landmarks.
    expect(screen.getByRole('heading', { name: 'Digital twin', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Real-time vehicle physical state')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument();

    // Section titles + panel titles (no hidden sections).
    for (const title of [
      'Live overview',
      'Component state',
      'Doors & openings',
      'Windows',
      'Security & status',
      'Lights & signals',
      'Live status',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }

    // KPI band — subtitles are unique; assert the derived open counts.
    expectKpi('of 6 openings', '2'); // driverFront + rear trunk
    expectKpi('of 4 windows', '1'); // FD open

    // Live status — two StatusBadges (Live Status panel + Security footer) show
    // the localized "Charging" status; the sentry chip is on.
    expect(screen.getAllByText('Charging').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Sentry on')).toBeInTheDocument();

    // Doors panel KV rows (from the JSON door_state).
    expectKv('Driver front', 'Open');
    expectKv('Frunk', 'Closed');
    expectKv('Trunk', 'Open');

    // Windows panel.
    expectKv('Front driver', 'Open');
    expectKv('Front passenger', 'Closed');

    // Lights panel.
    expectKv('Headlights', 'On');
    expectKv('Hazards', 'Off');
    expectKv('Turn signal', 'Left');

    // Security panel — occupied seat + not driving while charging.
    expectKv('Driver seat', 'Occupied');
    expectKv('Driving', 'No');

    // Last-updated caption (deterministic via the stubbed formatter).
    expect(screen.getByText(/Last updated/).textContent).toContain('MOCK_TIME');
  });

  it('shows a skeleton in every component panel while the security stream loads and leaks no values', () => {
    h.security = makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 });
    h.state = makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 });
    h.charging = makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 });

    renderPage();

    expect(screen.getByRole('heading', { name: 'Digital twin', level: 1 })).toBeInTheDocument();
    const components = screen.getByRole('region', { name: 'Component state' });
    const skeletons = components.querySelectorAll(
      '[aria-busy="true"] [aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]',
    );
    // Count only the four independent component panels, not overview metrics.
    expect(skeletons.length).toBeGreaterThanOrEqual(4);
    for (const title of ['Doors & openings', 'Windows', 'Security & status', 'Lights & signals']) {
      const pending = within(components).getByRole('status', { name: `Loading ${title}` });
      expect(pending.parentElement).toHaveAttribute('aria-busy', 'true');
      const skeleton = pending.querySelector(
        '[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]',
      );
      expect(skeleton).toHaveStyle({ height: '132px' });
      expect(skeleton).toHaveClass('w-full');
      expect(skeleton).not.toHaveClass('animate-pulse');
    }
    expect(screen.queryByText('Driver front')).not.toBeInTheDocument();
    expect(screen.queryByText('No door data available')).not.toBeInTheDocument();
  });

  it('surfaces QueryError in each panel and wires the Retry action to the query refetch', () => {
    h.security = makeQuery({ isError: true, error: new Error('boom'), dataUpdatedAt: 0 });
    h.state = makeQuery({ dataUpdatedAt: 0 });
    h.charging = makeQuery({ dataUpdatedAt: 0 });

    renderPage();

    expect(screen.getAllByText(/Can't reach server/i).length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('digital-twin-summary')).getByText('Source request failed')).toBeInTheDocument();

    const retry = screen.getAllByRole('button', { name: /^Retry$/i });
    expect(retry.length).toBeGreaterThanOrEqual(3);

    fireEvent.click(retry[0]); // doors panel → securityQ.refetch
    expect(h.security.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a per-section EmptyState and unknown status when no live data has arrived', () => {
    h.security = makeQuery({ data: null });
    h.state = makeQuery({ data: null });
    h.charging = makeQuery({ data: null });

    renderPage();

    expect(screen.getByText('No door data available')).toBeInTheDocument();
    expect(screen.getByText('No window data available')).toBeInTheDocument();
    expect(screen.getByText('No live status available')).toBeInTheDocument();
    expect(screen.getByText('No lights data available')).toBeInTheDocument();
    expect(within(screen.getByTestId('digital-twin-summary')).getByText('No source snapshots')).toBeInTheDocument();

    // KPIs degrade to an em dash rather than crashing.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
    expect(screen.queryByText('Parked')).not.toBeInTheDocument();
    expect(operationalMetricsSpy).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ occurrenceId: 'twin-status', rawValue: null }),
    ]));
  });

  it('renders the "no vehicles" empty state instead of the data scaffolding for an empty fleet', () => {
    h.vehicle = null;
    h.vehicles = [];

    renderPage();

    expect(
      screen.getByText('No vehicles found. Add a vehicle to see its digital twin.'),
    ).toBeInTheDocument();
    // The data scaffolding must NOT render behind the guard.
    expect(screen.queryByText('Live overview')).not.toBeInTheDocument();
    expect(screen.queryByText('Doors & openings')).not.toBeInTheDocument();
  });

  it('renders the shell spinner and no data sections while the vehicles list is loading', () => {
    h.vehicle = null;
    h.vehicles = [];
    h.vehiclesLoading = true;

    const { container } = renderPage();

    expect(screen.getByRole('heading', { name: 'Digital twin', level: 1 })).toBeInTheDocument();
    // PageContainer keeps the real header visible and renders the
    // accessible PageLoadSkeleton (role=status, name="Loading…") instead of
    // a centered spinner while the vehicles list is loading.
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
    expect(container.querySelector('[data-testid="page-load-skeleton"]')).not.toBeNull();
    expect(screen.queryByText('Live overview')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No vehicles found. Add a vehicle to see its digital twin.'),
    ).not.toBeInTheDocument();
  });

  it('shows fleet failure and retries the fleet request instead of claiming an empty fleet', () => {
    h.vehicle = null;
    h.fleet = makeQuery({ isError: true, error: new Error('fleet failed'), dataUpdatedAt: 0 });

    renderPage();

    expect(screen.getByText(/Can't reach server/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    expect(h.fleet.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No vehicles found/)).not.toBeInTheDocument();
    expect(screen.queryByText('Live overview')).not.toBeInTheDocument();
  });

  it('shows paused fleet recovery without an endless loading skeleton or an empty fleet', () => {
    h.vehicle = null;
    h.fleet = makeQuery({ isLoading: true, fetchStatus: 'paused', dataUpdatedAt: 0 });

    renderPage();

    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Fleet' }));
    expect(h.fleet.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('page-load-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByText(/No vehicles found/)).not.toBeInTheDocument();
    expect(screen.queryByText('Live overview')).not.toBeInTheDocument();
  });

  it('does not mistake an unresolved idle fleet for a successful empty response', () => {
    h.vehicle = null;
    h.fleet = makeQuery({ dataUpdatedAt: 0 });

    renderPage();

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/No vehicles found/)).not.toBeInTheDocument();
    expect(screen.queryByText('Live overview')).not.toBeInTheDocument();
  });

  it('preserves the selected twin during fleet refresh failure and removes the warning on recovery', () => {
    const fleet = makeQuery({ data: h.vehicles, isSuccess: true });
    h.fleet = fleet;
    const { rerender } = renderPage();
    const rerenderPage = () => rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/digital-twin']}>
          <DigitalTwinPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    h.fleet = { ...fleet, isSuccess: false, isError: true, error: new Error('refresh failed') };
    rerenderPage();

    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveTextContent('Fleet may be out of date');
    expect(screen.getByText('Live overview')).toBeInTheDocument();
    expect(screen.getByTestId('digital-twin-summary')).toHaveTextContent('Model 3');
    expectKv('Driver front', 'Open');
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(fleet.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/No vehicles found/)).not.toBeInTheDocument();

    h.fleet = { ...fleet, isFetching: true, fetchStatus: 'fetching' };
    rerenderPage();
    expect(screen.queryByTestId('page-load-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('Live overview')).toBeInTheDocument();

    h.fleet = { ...fleet, fetchStatus: 'paused' };
    rerenderPage();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByTestId('digital-twin-summary')).toHaveTextContent('Model 3');
    expect(screen.queryByTestId('page-load-skeleton')).not.toBeInTheDocument();

    h.fleet = { ...fleet, dataUpdatedAt: Date.now() };
    rerenderPage();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('digital-twin-summary')).toHaveTextContent('Model 3');
    expectKv('Driver front', 'Open');
  });

  it('renders measured zero openings and windows rather than treating them as empty', () => {
    h.security = makeQuery({ data: makeSecurity({
      door_state: '{"DriverFront":false,"PassengerFront":false,"DriverRear":false,"PassengerRear":false,"TrunkFront":false,"TrunkRear":false}',
      fd_window: 'Closed',
    }) });

    renderPage();

    expectKpi('of 6 openings', '0');
    expectKpi('of 4 windows', '0');
    expectKv('Driver front', 'Closed');
    expect(screen.queryByText(/No vehicles found/)).not.toBeInTheDocument();
  });

  it('resolves the badge to "driving" from the state endpoint when moving and not charging', () => {
    h.security = makeQuery({ data: null });
    h.charging = makeQuery({ data: null });
    h.state = makeQuery({
      data: makeState({ state: 'driving', is_charging: false, charger_power: 0, speed: 42 }),
    });

    renderPage();

    expect(screen.getAllByText('Driving').length).toBeGreaterThanOrEqual(1);
    expectKpi('of 6 openings', '—'); // no security data → openings unknown
  });

  it('does not infer "online" or inactive activity from a security snapshot', () => {
    h.state = makeQuery({ data: null });
    h.charging = makeQuery({ data: null });
    // Security present but nothing that implies charging/driving.
    h.security = makeQuery({
      data: makeSecurity({ door_state: 'closed', fd_window: 'Closed' }),
    });

    renderPage();

    expect(screen.queryByText('online')).not.toBeInTheDocument();
    expect(screen.queryByText('Parked')).not.toBeInTheDocument();
    expectKv('Driving', '—');
    expectKv('Charging', '—');
  });

  it.each([undefined, null, '', 'unknown', 42, false, {}, []])(
    'keeps untrusted state %j unknown without promoting snapshot availability',
    (state) => {
      h.state = makeQuery({ data: { state: { state }, live: false } });
      h.charging = makeQuery({ data: null });
      renderPage();
      expectKv('Driving', '—');
      expectKv('Charging', '—');
      expect(screen.queryByText('online')).not.toBeInTheDocument();
      expect(screen.queryByText('offline')).not.toBeInTheDocument();
      expect(screen.queryByText('Parked')).not.toBeInTheDocument();
    },
  );

  it.each([undefined, null, NaN, Infinity, -Infinity, '0', '0.5', {}])(
    'does not coerce invalid or missing activity input %j into a measurement',
    (value) => {
      h.state = makeQuery({ data: { state: { speed: value, charger_power: value, is_charging: value }, live: false } });
      h.charging = makeQuery({ data: { charging_state: value, charger_power_w: value } });
      renderPage();
      expectKv('Driving', '—');
      expectKv('Charging', '—');
      expect(screen.queryByText('Parked')).not.toBeInTheDocument();
      expect(operationalMetricsSpy).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ occurrenceId: 'twin-status', rawValue: null }),
      ]));
    },
  );

  it('rejects boolean measurements while retaining an explicit false charging flag', () => {
    h.state = makeQuery({
      data: { state: { speed: false, charger_power: false, is_charging: false }, live: false },
    });
    h.charging = makeQuery({ data: { charging_state: false, charger_power_w: false } });
    renderPage();
    expectKv('Driving', '—');
    expectKv('Charging', 'No');
    expect(screen.queryByText('Parked')).not.toBeInTheDocument();
  });

  it('distinguishes explicit false and measured zero from absent activity', () => {
    h.state = makeQuery({ data: { state: { speed: 0, is_charging: false }, live: false } });
    h.charging = makeQuery({ data: null });
    renderPage();
    expectKv('Driving', 'No');
    expectKv('Charging', 'No');
    expect(screen.getByText('Parked')).toBeInTheDocument();
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
  });

  it.each([-12, -0.25, 0.25, 12])('recognizes finite signed speed %s as driving', (speed) => {
    h.state = makeQuery({ data: { state: { speed, is_charging: false }, live: false } });
    h.charging = makeQuery({ data: null });
    renderPage();
    expectKv('Driving', 'Yes');
    expectKv('Charging', 'No');
    expect(screen.queryByText('driving')).not.toBeInTheDocument();
  });

  it.each([-12, -0.25, 0, 0.25, 12])('uses finite SI telemetry power %s without rounding or coercion', (power) => {
    h.state = makeQuery({ data: null });
    h.charging = makeQuery({ data: { charger_power_w: power } });
    renderPage();
    expectKv('Charging', power > 0 ? 'Yes' : 'No');
    expectKv('Driving', '—');
    expect(screen.queryByText('Parked')).not.toBeInTheDocument();
    expect(screen.queryByText('charging')).not.toBeInTheDocument();
  });

  it.each(['offline', 'asleep', 'online', 'parked', 'driving', 'charging'])(
    'preserves confirmed status %s',
    (state) => {
      h.state = makeQuery({ data: { ...makeState(), state: { state } } });
      h.charging = makeQuery({ data: null });
      renderPage();
      expect(screen.getAllByText(capitalize(state)).length).toBeGreaterThanOrEqual(2);
    },
  );

  it('does not treat an explicit live boolean as verified online evidence', () => {
    h.state = makeQuery({ data: { state: null, live: true } });
    h.charging = makeQuery({ data: null });
    renderPage();
    expect(screen.queryByText('online')).not.toBeInTheDocument();
    expectKv('Driving', '—');
    expectKv('Charging', '—');
  });

  it.each(['true', 1, {}, null])('rejects untrusted live flag %j', (live) => {
    h.state = makeQuery({ data: { state: null, live } });
    h.charging = makeQuery({ data: null });
    renderPage();
    expect(screen.queryByText('online')).not.toBeInTheDocument();
    expectKv('Driving', '—');
    expectKv('Charging', '—');
  });

  it.each([-0.5, 0, 0.5])('uses state charger power %s as a nullable activity measurement', (power) => {
    h.state = makeQuery({ data: { state: { charger_power: power }, live: false } });
    h.charging = makeQuery({ data: null });
    renderPage();
    expectKv('Charging', power > 0 ? 'Yes' : 'No');
    expectKv('Driving', '—');
  });

  it('retains all component details and the interactive twin during a security refresh failure', () => {
    h.security = makeQuery({ data: makeSecurity(), isError: true, error: new Error('refresh failed') });
    renderPage();
    expectKv('Driver front', 'Open');
    expectKv('Front passenger', 'Closed');
    expectKv('Headlights', 'On');
    expectKv('Driver seat', 'Occupied');
    expect(screen.getByText('Security & status may be out of date')).toBeInTheDocument();
    expect(screen.queryByText('No door data available')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Component state' })).toBeInTheDocument();
    expect(h.security.refetch).not.toHaveBeenCalled();
  });

  it('keeps raw counts, component denominators and source reasons in the real Review details drawer', () => {
    renderPage();
    const brief = screen.getByTestId('digital-twin-summary');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(brief.querySelector('[data-operational-metric="twin-doors"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="twin-windows"]')).toHaveAttribute('data-value-state', 'value');
    expect(operationalMetricsSpy).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ metricId: 'count', occurrenceId: 'twin-doors', rawValue: 2 }),
      expect.objectContaining({ metricId: 'count', occurrenceId: 'twin-windows', rawValue: 1 }),
    ]));
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Physical-state summary details' });
    expect(within(drawer).getByText('of 6 openings')).toBeInTheDocument();
    expect(within(drawer).getByText('of 4 windows')).toBeInTheDocument();
    expect(within(drawer).getByText('6 of 6 states known')).toBeInTheDocument();
    expect(within(drawer).getByText('4 of 4 states known')).toBeInTheDocument();
    expect(within(drawer).getByText(/Unreported openings are not assumed closed/)).toBeInTheDocument();
    expect(within(drawer).getAllByText(/Source snapshots may differ in time/).length).toBeGreaterThan(0);
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live overview' })).toBeInTheDocument();
    expectKv('Driver front', 'Open');
  });

  it('keeps reported closed states at zero and false distinct from unreported components', () => {
    h.state = makeQuery({ data: null });
    h.charging = makeQuery({ data: null });
    h.security = makeQuery({ data: makeSecurity({
      door_state: '{"DriverFront":false}', fd_window: null, fp_window: null,
      rd_window: null, rp_window: null, locked: false, sentry_mode: false,
    }) });
    renderPage();
    const brief = screen.getByTestId('digital-twin-summary');
    const doors = brief.querySelector('[data-operational-metric="twin-doors"]');
    const windows = brief.querySelector('[data-operational-metric="twin-windows"]');
    expect(doors).toHaveAttribute('data-value-state', 'value');
    expect(doors).toHaveTextContent('0');
    expect(doors).toHaveTextContent('1 of 6 states known');
    expect(windows).toHaveAttribute('data-value-state', 'missing');
    expect(windows).toHaveTextContent('—');
    expect(brief.querySelector('[data-operational-metric="twin-lock"]')).toHaveTextContent('Unlocked');
    expect(brief.querySelector('[data-operational-metric="twin-sentry"]')).toHaveTextContent('Inactive');
    expect(within(brief).getByText('Mixed source availability')).toBeInTheDocument();
    expect(operationalMetricsSpy).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ occurrenceId: 'twin-doors', rawValue: 0 }),
      expect.objectContaining({ occurrenceId: 'twin-windows', rawValue: null }),
    ]));
  });

  it('marks the brief busy without leaking measured values during initial loading', () => {
    h.security = makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 });
    h.state = makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 });
    h.charging = makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 });
    renderPage();
    const brief = screen.getByTestId('digital-twin-summary');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(within(brief).getByText('Loading source snapshots')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Component state' })).toBeInTheDocument();
  });

  it('keeps the brief and its reviewable counts after a retained refresh failure', () => {
    h.security = makeQuery({ data: makeSecurity(), isError: true, error: new Error('refresh failed') });
    renderPage();
    const brief = screen.getByTestId('digital-twin-summary');
    expect(within(brief).getByText('Retained source snapshots')).toBeInTheDocument();
    expectKpi('of 6 openings', '2');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Physical-state summary details' });
    expect(within(drawer).getByText('Retained source snapshots')).toBeInTheDocument();
    expect(within(drawer).getByText('of 6 openings')).toBeInTheDocument();
    expect(within(drawer).getByText(/retained values remain visible after a refresh failure/)).toBeInTheDocument();
  });

  it('distinguishes paused first requests from active loading and successful empty responses', () => {
    h.security = makeQuery({ isLoading: true, fetchStatus: 'paused', dataUpdatedAt: 0 });
    h.state = makeQuery({ isLoading: true, fetchStatus: 'paused', dataUpdatedAt: 0 });
    h.charging = makeQuery({ isLoading: true, fetchStatus: 'paused', dataUpdatedAt: 0 });
    renderPage();
    expect(within(screen.getByTestId('digital-twin-summary')).getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading Doors & openings' })).not.toBeInTheDocument();
    expect(screen.queryByText('Source request failed')).not.toBeInTheDocument();
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
    expect(screen.queryByText('No source snapshots')).not.toBeInTheDocument();
  });

  it('qualifies missing observation evidence despite a recent successful fetch', () => {
    h.state = makeQuery({ data: { ...makeState(), observedAt: null, freshness: 'unknown', verifiedFields: [] } });
    renderPage();
    expect(within(screen.getByTestId('digital-twin-summary')).getByText('Unverified')).toBeInTheDocument();
    expect(screen.queryByText('charging')).not.toBeInTheDocument();
    expect(screen.getByText(/No verified observation time for this vehicle/)).toBeInTheDocument();
    expectKv('Charging', 'Yes');
    expectKv('Driver front', 'Open');
  });

  it('preserves verified zero and false activity without promoting conflicting charging snapshots', () => {
    h.state = makeQuery({ data: makeState({ state: 'parked', speed: 0, is_charging: false, charger_power: 0 }) });
    renderPage();
    expect(screen.getAllByText('Parked', { selector: 'span' })).toHaveLength(2);
    expect(screen.queryByText('charging')).not.toBeInTheDocument();
    expectKv('Driving', 'No');
    expectKpi('of 6 openings', '2');
  });

  it('uses the observation age rather than the fetch time and rejects expired operational status', () => {
    h.state = makeQuery({ data: { ...makeState(), observedAt: Date.now() - 600_000 } });
    renderPage();
    expect(screen.queryByText('charging')).not.toBeInTheDocument();
    expect(screen.getByTestId('twin-source-observations')).toHaveTextContent('Last real observation 10m ago');
    expect(screen.getByTestId('twin-source-observations')).toHaveTextContent('Stale');
    expectKv('Charging', 'Yes');
  });

  it('retains state values through failure and paused refresh, then restores verified status independently', () => {
    const data = makeState();
    h.state = makeQuery({ data, isError: true, error: new Error('refresh failed') });
    const view = renderPage();
    expect(screen.queryByText('charging')).not.toBeInTheDocument();
    expectKv('Charging', 'Yes');
    expectKv('Driver front', 'Open');
    const warning = screen.getByText('Live status may be out of date').closest('[data-testid="stale-refresh-warning"]');
    if (!(warning instanceof HTMLElement)) throw new Error('Missing state refresh warning');
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(h.state.refetch).toHaveBeenCalledTimes(1);
    expect(h.security.refetch).not.toHaveBeenCalled();
    h.state = makeQuery({ data, fetchStatus: 'paused' });
    view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><DigitalTwinPage /></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByText('charging')).not.toBeInTheDocument();
    expectKv('Charging', 'Yes');
    expect(screen.getByTestId('twin-source-observations')).toHaveTextContent('Refresh paused');
    h.state = makeQuery({ data });
    view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><DigitalTwinPage /></MemoryRouter></QueryClientProvider>);
    expectKv('Charging', 'Yes');
    expect(screen.queryByText('Live status may be out of date')).not.toBeInTheDocument();
    expectKv('Driver front', 'Open');
  });
});

describe('statusNeon', () => {
  it('maps known vehicle statuses to their color-blind-safe accent', () => {
    expect(statusNeon('driving')).toBe('green');
    expect(statusNeon('charging')).toBe('cyan');
    expect(statusNeon('online')).toBe('blue');
    expect(statusNeon('offline')).toBe('red');
    expect(statusNeon('asleep')).toBe('purple');
    expect(statusNeon('parked')).toBe('amber');
  });

  it('falls back to cyan for unknown / uncovered statuses', () => {
    expect(statusNeon('updating')).toBe('cyan');
    expect(statusNeon('totally-unknown')).toBe('cyan');
    expect(statusNeon('')).toBe('cyan');
  });
});

describe('capitalize', () => {
  it('upper-cases the first character and preserves the rest', () => {
    expect(capitalize('offline')).toBe('Offline');
    expect(capitalize('a')).toBe('A');
    expect(capitalize('ABC')).toBe('ABC');
  });

  it('returns an em dash for an empty string', () => {
    expect(capitalize('')).toBe('—');
  });
});


describe('DigitalTwinPage shared icon presentation', () => {
  it.each(['ready', 'empty', 'retained refresh failure'] as const)(
    'keeps all five decorative panel icons neutral and non-focusable when sources are %s',
    (sourceState) => {
      if (sourceState === 'empty') {
        h.security = makeQuery({ data: null });
        h.state = makeQuery({ data: null });
        h.charging = makeQuery({ data: null });
      } else if (sourceState === 'retained refresh failure') {
        h.security = makeQuery({ data: makeSecurity(), isError: true, error: new Error('refresh failed') });
      }

      renderPage();
      const panelIcon = (title: string) => screen.getByRole('heading', { name: title })
        .closest('[data-card]')?.querySelector('[data-card-content] svg.lucide[aria-hidden="true"]');
      const icons = [
        screen.getByRole('region', { name: 'Live overview' }).querySelector('svg.lucide[aria-hidden="true"]'),
        ...['Doors & openings', 'Windows', 'Security & status', 'Lights & signals'].map((title) =>
          panelIcon(title),
        ),
      ];
      expect(icons).toHaveLength(5);
      for (const icon of icons) {
        expect(icon).toBeInTheDocument();
        expect(icon).toHaveClass('w-4', 'h-4');
        expect(icon).not.toHaveClass('text-cyan-300');
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(icon).toHaveAttribute('focusable', 'false');
      }
      expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Live overview' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Component state' })).toBeInTheDocument();
    },
  );

  it('preserves the four source-empty informational glyphs and their original dimensions', () => {
    h.security = makeQuery({ data: null });
    h.state = makeQuery({ data: null });
    h.charging = makeQuery({ data: null });
    renderPage();
    const icons = screen.getByRole('region', { name: 'Component state' }).querySelectorAll('svg.lucide-info');
    expect(icons).toHaveLength(4);
    for (const icon of icons) {
      expect(icon).toHaveClass('h-6', 'w-6', 'shrink-0');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('focusable', 'false');
    }
  });

  it('preserves the fleet-empty vehicle glyph size without adding an accessible image or action', () => {
    h.vehicle = null;
    h.vehicles = [];
    const { container } = renderPage();
    const icon = container.querySelector('svg.lucide-car');
    expect(icon).toHaveClass('h-8', 'w-8', 'shrink-0');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('focusable', 'false');
    expect(screen.getByText('No vehicles found. Add a vehicle to see its digital twin.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
