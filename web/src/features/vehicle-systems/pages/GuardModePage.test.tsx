/**
 * GuardModePage — contract + hardening tests.
 *
 * GuardModePage is the anti-theft dashboard. It fans five guard hooks
 * (`useGuardConfig`, `useGuardEvents`, `useSetGuardConfig`, `useGuardPanic`,
 * `useAcknowledgeGuardEvent`) plus `useVehicleState` and `useGeofences` into
 * six surfaces: a triggered alert banner, a six-tile KPI band, a live leaflet
 * map + arm/disarm + emergency-panic control rail, a settings panel, a status
 * list, and an event timeline.
 *
 * The hooks are mocked directly (the EfficiencyPage / DriveDetailPage
 * convention) via hoisted mutable state so every branch — armed / disarmed /
 * triggered, loading / error / empty, locked / unlocked, sentry on / off — is
 * reachable deterministically. The real `isGuardEventAcknowledged` helper is
 * kept (only the hooks are overridden). `react-i18next` is stubbed for English
 * fallbacks; `useSettings` / `useTimezone` come from the global stub in
 * src/test-setup.ts. The jsdom-hostile leaflet barrel (`@/components/maps`) is
 * replaced with inert prop-capturing stubs. Interactions use `fireEvent`
 * (`@testing-library/user-event` is not installed in this repo).
 *
 * The elevation this file locks in fixes a real bug: the auto-panic draft used
 * a plain `false` default while the toggle displayed `draft || persisted`, so a
 * persisted `auto_panic: true` was silently reset to `false` on Save and the
 * switch could never be turned back off. The source now derives a single
 * `effectiveAutoPanic` (`draft ?? persisted ?? false`) used for BOTH display
 * and every mutation — the two regression tests below pin that.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { GuardConfig, GuardEvent } from '@/api/hooks/useGuard';
import type { Geofence } from '@/types/location';

/* ── react-i18next: deterministic English-fallback rendering ─────────────── */
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined;
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined);
        const interpolate = (s: string) =>
          opts
            ? Object.keys(opts).reduce(
                (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
                s,
              )
            : s;
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue);
        if (fallback != null) return interpolate(fallback);
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

/* ── Hoisted mutable state shared with the (hoisted) vi.mock factories ────── */
const H = vi.hoisted(() => ({
  vehicle: { vehicleId: 42 as number, vehicle: { display_name: 'Model Y Test' } as Record<string, unknown> | null },
  config: { current: undefined as unknown },
  events: { current: undefined as unknown },
  vstate: { current: undefined as unknown },
  geofences: { current: undefined as unknown },
  setConfig: { mutate: vi.fn(), isPending: false },
  panic: { mutate: vi.fn(), isPending: false },
  ackEvent: { mutate: vi.fn(), isPending: false },
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: H.vehicle.vehicleId,
    vehicle: H.vehicle.vehicle,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/api/hooks/useGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useGuard')>();
  return {
    ...actual, // keep the real isGuardEventAcknowledged
    useGuardConfig: () => H.config.current,
    useGuardEvents: () => H.events.current,
    useSetGuardConfig: () => H.setConfig,
    useGuardPanic: () => H.panic,
    useAcknowledgeGuardEvent: () => H.ackEvent,
  };
});

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicleState: () => H.vstate.current,
}));

vi.mock('@/api/hooks/useLocations', () => ({
  useGeofences: () => ({ data: H.geofences.current }),
}));

/* Header action wiring (store/query-backed) is out of scope. */
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

/* ── Inert leaflet barrel — capture props, never touch canvas/leaflet ────── */
vi.mock('@/components/maps', () => ({
  MapContainer: ({ children }: { children?: ReactNode }) => <div data-testid="guard-map">{children}</div>,
  Marker: ({ children }: { children?: ReactNode }) => <div data-testid="guard-marker">{children}</div>,
  Popup: ({ children }: { children?: ReactNode }) => <div data-testid="guard-popup">{children}</div>,
  Circle: (props: { radius?: number }) => (
    <div data-testid="guard-geofence-circle" data-radius={props.radius} />
  ),
  Polyline: () => <div data-testid="guard-polyline" />,
  MapTileLayer: () => null,
  MapInvalidator: () => null,
  vehicleIcon: () => ({}),
}));

import GuardModePage from './GuardModePage';

/* ── Fake query + fixtures ───────────────────────────────────────────────── */
interface FakeQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery<T>(over: Partial<FakeQuery<T>> = {}): FakeQuery<T> {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeConfig(over: Partial<GuardConfig> = {}): GuardConfig {
  return {
    vehicle_id: 42,
    enabled: true,
    home_geofence_id: 5,
    sensitivity: 'high',
    auto_panic: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-06-01T10:00:00Z',
    ...over,
  };
}

function makeEvent(over: Partial<GuardEvent> = {}): GuardEvent {
  return {
    id: 1,
    vehicle_id: 42,
    ts: '2026-06-01T10:00:00Z',
    event_type: 'locked',
    from_state: null,
    to_state: null,
    details: null,
    acknowledged_at: null,
    acknowledged_by: null,
    ...over,
  };
}

function makeGeofence(over: Partial<Geofence> = {}): Geofence {
  return {
    id: '5',
    name: 'Home',
    latitude: 37.5,
    longitude: -121.9,
    radius: 100,
    alertOnEntry: true,
    alertOnExit: false,
    enabled: true,
    costPerKwh: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function makeState(over: Record<string, unknown> = {}) {
  return {
    state: {
      vehicle_id: 42,
      latitude: 37.5,
      longitude: -121.9,
      is_locked: true,
      sentry_mode: true,
      ...over,
    },
    live: true,
  };
}

interface InstallOpts {
  config?: FakeQuery<GuardConfig>;
  events?: FakeQuery<GuardEvent[]>;
  state?: FakeQuery<ReturnType<typeof makeState>>;
  geofences?: Geofence[];
}

function install(opts: InstallOpts = {}) {
  H.config.current = opts.config ?? makeQuery<GuardConfig>({ data: makeConfig() });
  H.events.current = opts.events ?? makeQuery<GuardEvent[]>({ data: [] });
  H.vstate.current = opts.state ?? makeQuery({ data: makeState() });
  H.geofences.current = opts.geofences ?? [makeGeofence()];
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/guard']}>
      <QueryClientProvider client={client}>
        <GuardModePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const kpi = () => within(screen.getByRole('region', { name: 'Guard status overview' }));

beforeEach(() => {
  H.vehicle.vehicleId = 42;
  H.vehicle.vehicle = { display_name: 'Model Y Test' };
  H.setConfig.mutate.mockClear();
  H.setConfig.isPending = false;
  H.panic.mutate.mockClear();
  H.panic.isPending = false;
  H.ackEvent.mutate.mockClear();
  H.ackEvent.isPending = false;
  install();
});

/* ── KPI band, banner + status ───────────────────────────────────────────── */
describe('GuardModePage — status surfaces', () => {
  it('renders every KPI, the triggered banner, and status rows for an armed+triggered vehicle', () => {
    install({
      config: makeQuery<GuardConfig>({ data: makeConfig({ enabled: true, sensitivity: 'high' }) }),
      events: makeQuery<GuardEvent[]>({
        data: [
          makeEvent({ id: 10, event_type: 'unauthorized_drive', from_state: 'parked', to_state: 'driving' }),
          makeEvent({ id: 11, event_type: 'locked', acknowledged_at: '2026-06-01T09:00:00Z', acknowledged_by: 'admin' }),
        ],
      }),
      state: makeQuery({ data: makeState({ is_locked: true, sentry_mode: true }) }),
    });
    renderPage();

    // Triggered banner (latest event is unacknowledged + not a test alert).
    expect(screen.getByText('Guard Alert Triggered!')).toBeInTheDocument();

    // Six KPI tiles, scoped to the overview region to avoid label collisions.
    const band = kpi();
    expect(band.getByText('Guard State')).toBeInTheDocument();
    expect(band.getByText('Triggered')).toBeInTheDocument();
    expect(band.getByText('On')).toBeInTheDocument(); // sentry
    expect(band.getByText('Locked')).toBeInTheDocument(); // lock
    expect(band.getByText('High')).toBeInTheDocument(); // sensitivity
    expect(band.getByText('1')).toBeInTheDocument(); // unacknowledged
    expect(band.getByText('2')).toBeInTheDocument(); // total events

    // Status list reflects locked / sentry / unacknowledged.
    expect(screen.getByText('Vehicle locked')).toBeInTheDocument();
    expect(screen.getByText('Sentry mode active')).toBeInTheDocument();
    expect(screen.getByText('1 unacknowledged event(s)')).toBeInTheDocument();
  });

  it('shows disarmed / unlocked / sentry-off state with no triggered banner when the latest event is acknowledged', () => {
    install({
      config: makeQuery<GuardConfig>({ data: makeConfig({ enabled: false, sensitivity: 'low' }) }),
      events: makeQuery<GuardEvent[]>({
        data: [makeEvent({ id: 20, event_type: 'sentry_mode', acknowledged_at: '2026-06-01T09:00:00Z' })],
      }),
      state: makeQuery({ data: makeState({ is_locked: false, sentry_mode: false }) }),
    });
    renderPage();

    expect(screen.queryByText('Guard Alert Triggered!')).not.toBeInTheDocument();
    const band = kpi();
    expect(band.getByText('Disarmed')).toBeInTheDocument();
    expect(band.getByText('Unlocked')).toBeInTheDocument();
    expect(band.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Vehicle unlocked')).toBeInTheDocument();
    expect(screen.getByText('Sentry mode off')).toBeInTheDocument();
    expect(screen.getByText('No active alerts')).toBeInTheDocument();
    // Off KPI value present (sentry off), no unacknowledged events.
    expect(band.getByText('Off')).toBeInTheDocument();
  });

  it('renders KPI skeletons (no metric labels) while the config is loading', () => {
    install({ config: makeQuery<GuardConfig>({ isLoading: true, data: undefined }) });
    renderPage();

    // The <section aria-label="Guard status overview"> is replaced by a
    // skeleton grid while loading, so the metric labels are absent.
    expect(screen.queryByRole('region', { name: 'Guard status overview' })).not.toBeInTheDocument();
    expect(screen.queryByText('Guard State')).not.toBeInTheDocument();
    // The page shell (title) still renders.
    expect(screen.getByRole('heading', { level: 1, name: 'Guard Mode' })).toBeInTheDocument();
  });
});

/* ── Arm / disarm + settings (auto-panic regression) ─────────────────────── */
describe('GuardModePage — arm/disarm + settings', () => {
  it('arms via the Guard Mode switch and forwards the persisted auto_panic (regression: no silent reset)', () => {
    install({
      config: makeQuery<GuardConfig>({
        data: makeConfig({ enabled: false, auto_panic: true, sensitivity: 'medium', home_geofence_id: null }),
      }),
    });
    renderPage();

    const guardSwitch = screen.getByRole('switch', { name: 'Guard Mode' });
    expect(guardSwitch).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(guardSwitch);

    expect(H.setConfig.mutate).toHaveBeenCalledTimes(1);
    // Untouched auto-panic must be sent as the *persisted* value (true), not
    // the old draft default (false) which silently disarmed the feature.
    expect(H.setConfig.mutate).toHaveBeenCalledWith({
      vehicleId: 42,
      enabled: true,
      home_geofence_id: null,
      sensitivity: 'medium',
      auto_panic: true,
    });
  });

  it('lets the auto-panic switch turn OFF a persisted true and Saves the toggled value (regression: switch is operable)', () => {
    install({
      config: makeQuery<GuardConfig>({
        data: makeConfig({ enabled: true, auto_panic: true, sensitivity: 'high', home_geofence_id: 5 }),
      }),
    });
    renderPage();

    const autoPanicSwitch = screen.getByRole('switch', { name: 'Auto-Panic on Trigger' });
    // Reflects persisted state.
    expect(autoPanicSwitch).toHaveAttribute('aria-checked', 'true');

    // Under the old code the switch was stuck on (draft || persisted); now it flips.
    fireEvent.click(autoPanicSwitch);
    expect(autoPanicSwitch).toHaveAttribute('aria-checked', 'false');

    // Also change sensitivity, then Save — both draft edits must be persisted.
    fireEvent.change(screen.getByLabelText('Sensitivity'), { target: { value: 'low' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(H.setConfig.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleId: 42, enabled: true, sensitivity: 'low', auto_panic: false }),
    );
  });

  it('saves a selected home geofence id as a number', () => {
    install({
      config: makeQuery<GuardConfig>({ data: makeConfig({ home_geofence_id: null }) }),
      geofences: [makeGeofence({ id: '7', name: 'Office' })],
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('Home Geofence'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(H.setConfig.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ home_geofence_id: 7 }),
    );
  });
});

/* ── Emergency panic ─────────────────────────────────────────────────────── */
describe('GuardModePage — emergency panic', () => {
  it('opens the confirm dialog and triggers panic on confirm', () => {
    renderPage();

    // No dialog until the Emergency button is pressed.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Activate Panic/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Activate Panic Mode?')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Activate Panic' }));
    expect(H.panic.mutate).toHaveBeenCalledWith(42);
  });

  it('does not trigger panic when the dialog is cancelled', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Activate Panic/i }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(H.panic.mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables panic + save and ignores the guard toggle when no vehicle is selected', () => {
    H.vehicle.vehicleId = 0;
    H.vehicle.vehicle = null;
    install({ config: makeQuery<GuardConfig>({ data: undefined }) });
    renderPage();

    expect(screen.getByRole('button', { name: /Activate Panic/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeDisabled();

    // Guard toggle is a no-op with no vehicle (guarded by activeVehicleId <= 0).
    fireEvent.click(screen.getByRole('switch', { name: 'Guard Mode' }));
    expect(H.setConfig.mutate).not.toHaveBeenCalled();
  });
});

/* ── Event timeline ──────────────────────────────────────────────────────── */
describe('GuardModePage — event timeline', () => {
  it('acknowledges an unacknowledged event and hides the Ack control on acknowledged ones', () => {
    install({
      config: makeQuery<GuardConfig>({ data: makeConfig({ enabled: true }) }),
      // Latest is acknowledged so no triggered banner steals focus; the second
      // row is unacknowledged and owns the Ack button.
      events: makeQuery<GuardEvent[]>({
        data: [
          makeEvent({ id: 30, event_type: 'sentry_mode', acknowledged_at: '2026-06-01T09:00:00Z', acknowledged_by: 'ops' }),
          makeEvent({ id: 31, event_type: 'unauthorized_unlock', acknowledged_at: null }),
        ],
      }),
    });
    renderPage();

    expect(screen.getByText(/Acknowledged by/)).toBeInTheDocument();
    const ackButtons = screen.getAllByRole('button', { name: 'Acknowledge event' });
    expect(ackButtons).toHaveLength(1); // only the unacknowledged event has one

    fireEvent.click(ackButtons[0]);
    expect(H.ackEvent.mutate).toHaveBeenCalledWith({ vehicleId: 42, eventId: 31 });
  });

  it('renders the raw event_type token for unknown types (label lookup fallback)', () => {
    install({
      events: makeQuery<GuardEvent[]>({
        data: [makeEvent({ id: 40, event_type: 'brand_new_backend_type', acknowledged_at: '2026-06-01T09:00:00Z' })],
      }),
    });
    renderPage();

    // No dedicated label key exists, so the raw token renders without crashing.
    expect(screen.getByText('brand_new_backend_type')).toBeInTheDocument();
  });

  it('surfaces a query error with a working Retry, and an honest empty state', () => {
    const errored = makeQuery<GuardEvent[]>({ isError: true, error: new Error('events boom'), data: undefined });
    install({ events: errored });
    const { rerender } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(errored.refetch).toHaveBeenCalledTimes(1);

    // Now flip to an empty (but successful) feed → honest empty state, no error.
    install({ events: makeQuery<GuardEvent[]>({ data: [] }) });
    rerender(
      <MemoryRouter initialEntries={['/guard']}>
        <QueryClientProvider client={new QueryClient()}>
          <GuardModePage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('No guard events yet')).toBeInTheDocument();
  });
});

/* ── Live map ────────────────────────────────────────────────────────────── */
describe('GuardModePage — live map', () => {
  it('renders the map, vehicle marker, and home-geofence circle when a location is present', () => {
    install({
      config: makeQuery<GuardConfig>({ data: makeConfig({ home_geofence_id: 5 }) }),
      state: makeQuery({ data: makeState({ latitude: 37.5, longitude: -121.9 }) }),
      geofences: [makeGeofence({ id: '5', radius: 250 })],
    });
    renderPage();

    expect(screen.getByTestId('guard-map')).toBeInTheDocument();
    expect(screen.getByTestId('guard-marker')).toBeInTheDocument();
    expect(screen.getByText('Model Y Test')).toBeInTheDocument(); // popup name
    expect(screen.getByTestId('guard-geofence-circle')).toHaveAttribute('data-radius', '250');
  });

  it('shows the no-location empty state, and the map error branch offers Retry', () => {
    // (a) location absent → empty state.
    install({ state: makeQuery({ data: makeState({ latitude: 0, longitude: 0 }) }) });
    const { unmount } = renderPage();
    expect(screen.getByText('No vehicle location available')).toBeInTheDocument();
    expect(screen.queryByTestId('guard-map')).not.toBeInTheDocument();
    unmount();

    // (b) state query errored → QueryError with a Retry wired to refetch.
    const errored = makeQuery({ isError: true, error: new Error('state boom'), data: undefined });
    install({ state: errored, events: makeQuery<GuardEvent[]>({ data: [] }) });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(errored.refetch).toHaveBeenCalledTimes(1);
  });
});
