import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { GuardConfig, GuardEvent } from '@/api/hooks/useGuard';
import type { DataStateSource } from '@/api/dataState';
import type { useVehicleState } from '@/api/hooks/useVehicles';
import type { Geofence } from '@/types/location';

type HookStateResponse = NonNullable<ReturnType<typeof useVehicleState>['data']>;
// Mock sparse/malformed snapshots without changing the read-only production DTO.
type StateResponse = Omit<HookStateResponse, 'state'> & {
  state?: Partial<NonNullable<HookStateResponse['state']>>;
};
type Source<T> = DataStateSource<T> & { refetch: ReturnType<typeof vi.fn> };
const H = vi.hoisted(() => ({
  vehicleId: 42,
  config: {} as Source<GuardConfig | null>,
  events: {} as Source<GuardEvent[]>,
  state: {} as Source<StateResponse>,
  geofences: {} as Source<Geofence[]>,
  setConfig: { mutate: vi.fn(), isPending: false, error: null as Error | null },
  panic: { mutate: vi.fn(), isPending: false, error: null as Error | null },
  ack: { mutate: vi.fn(), isPending: false, error: null as Error | null },
}));

vi.mock('react-i18next', async importOriginal => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({
    t: (key: string, second?: unknown, third?: unknown) => {
      const opts = second != null && typeof second === 'object'
        ? second as Record<string, unknown>
        : third != null && typeof third === 'object' ? third as Record<string, unknown> : {};
      const fallback = typeof second === 'string' ? second
        : typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
      return Object.entries(opts).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)), fallback);
    },
    i18n: { language: 'en' },
  }) };
});
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: H.vehicleId, vehicle: { display_name: 'Test vehicle' } }),
}));
vi.mock('@/api/hooks/useGuard', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useGuard')>();
  return { ...actual,
    useGuardConfig: () => H.config,
    useGuardEvents: () => H.events,
    useSetGuardConfig: () => H.setConfig,
    useGuardPanic: () => H.panic,
    useAcknowledgeGuardEvent: () => H.ack,
  };
});
vi.mock('@/api/hooks/useVehicles', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicleState: () => H.state };
});
vi.mock('@/api/hooks/useLocations', () => ({ useGeofences: () => H.geofences }));
// Keep the remaining motion exports: PageContainer/overlays may consume them.
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> };
});
vi.mock('@/components/maps', () => ({
  MapContainer: ({ children, center }: { children: ReactNode; center: [number, number] }) =>
    <div data-testid="guard-map" data-latitude={center[0]} data-longitude={center[1]}>{children}</div>,
  Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Circle: ({ radius }: { radius: number }) => <div data-testid="geofence-circle" data-radius={radius} />,
  Polyline: () => <div data-testid="event-trail" />,
  MapTileLayer: () => null,
  MapInvalidator: () => null,
  vehicleIcon: () => ({}),
}));
vi.mock('@/components/data-display', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/data-display')>();
  return { ...actual, TimeStamp: ({ value }: { value: string | number }) =>
    <time dateTime={String(value)}>{String(value)}</time> };
});
// Use the real placement engine but isolate unrelated shell query/header wiring.
vi.mock('@/components/layout/layout-reference', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/layout/layout-reference')>();
  return { ...actual, PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> };
});

import GuardModePage from '../../pages/GuardModePage';
import { useGuardPageModel } from './useGuardPageModel';

function query<T>(data: T | undefined, overrides: Partial<Source<T>> = {}): Source<T> {
  return { data, error: null, isLoading: false, isFetching: false, isError: false,
    dataUpdatedAt: Date.now(), refetch: vi.fn(), ...overrides };
}
function config(overrides: Partial<GuardConfig> = {}): GuardConfig {
  return { vehicle_id: 42, enabled: true, home_geofence_id: 5, sensitivity: 'high',
    auto_panic: true, created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-06-01T10:00:00Z', ...overrides };
}
function event(overrides: Partial<GuardEvent> = {}): GuardEvent {
  return { id: 7, vehicle_id: 42, ts: '2026-06-01T10:00:00Z', event_type: 'locked',
    from_state: 'false', to_state: 'true', details: null, acknowledged_at: null,
    acknowledged_by: null, ...overrides };
}
function state(overrides: Partial<StateResponse> = {}): StateResponse {
  return { state: { vehicle_id: 42, latitude: 37.5, longitude: -121.9,
    is_locked: true, sentry_mode: true }, live: true, observedAt: Date.now(),
    freshness: 'fresh', verifiedFields: ['latitude', 'longitude', 'is_locked', 'sentry_mode'],
    ...overrides };
}
const geofence: Geofence = {
  id: '5', name: 'Home', latitude: 37.5, longitude: -121.9, radius: 100,
  alertOnEntry: true, alertOnExit: false, enabled: true, origin: 'manual',
  needsReview: false, createdAt: '2026-01-01T00:00:00Z',
};
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><GuardModePage /></QueryClientProvider></MemoryRouter>);
}
function metric(label: string) {
  const overview = screen.getByRole('region', { name: 'Guard status overview' });
  const query = within(overview);
  // Tooltip descriptions may legitimately repeat a metric's label text.
  const selector = '[data-stat-label]';
  expect(query.getAllByText(label, { selector })).toHaveLength(1);
  const tile = query.getByText(label, { selector }).closest('[data-stat]');
  if (!(tile instanceof HTMLElement)) throw new Error(`Missing metric tile for ${label}`);
  expect(overview).toContainElement(tile);
  expect(tile.querySelectorAll('[data-stat-label]')).toHaveLength(1);
  return tile;
}
function section(name: string) {
  const el = document.querySelector(`[data-guard-section="${name}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`Missing ${name} section`);
  return within(el);
}
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  H.vehicleId = 42;
  H.config = query(config());
  H.events = query([]);
  H.state = query(state());
  H.geofences = query([geofence]);
  for (const mutation of [H.setConfig, H.panic, H.ack]) {
    mutation.isPending = false;
    mutation.error = null;
  }
});

describe('guard live modernization preservation', () => {
  it('keeps every panel, six metrics and the single card grid when sources fail independently', () => {
    H.config = query(undefined, { error: new Error('config unavailable'), isError: true });
    H.events = query(undefined, { error: new Error('events unavailable'), isError: true });
    renderPage();
    for (const name of ['map', 'arming', 'panic', 'settings', 'status', 'events'])
      expect(document.querySelector(`[data-guard-section="${name}"]`)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-stat]')).toHaveLength(6);
    expect(document.querySelectorAll('[data-card-grid]')).toHaveLength(1);
    expect(screen.getByTestId('guard-map')).toBeInTheDocument();
    expect(metric('Lock state')).toHaveTextContent('Locked');
    expect(metric('Total events')).toHaveAttribute('data-state', 'missing');
    expect(H.setConfig.mutate).not.toHaveBeenCalled();
    expect(H.panic.mutate).not.toHaveBeenCalled();
    expect(H.ack.mutate).not.toHaveBeenCalled();
  });

  it('distinguishes unknown policy and events from disabled policy and measured zero events', () => {
    H.config = query(undefined);
    H.events = query(undefined);
    const view = renderPage();
    expect(metric('Guard state')).toHaveAttribute('data-state', 'missing');
    expect(metric('Unacknowledged')).toHaveAttribute('data-state', 'missing');
    expect(section('status').queryByText('No active alerts')).not.toBeInTheDocument();
    H.config = query(config({ enabled: false }));
    H.events = query([]);
    view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}><GuardModePage /></QueryClientProvider></MemoryRouter>);
    expect(metric('Guard state')).toHaveTextContent('Disarmed');
    expect(metric('Unacknowledged')).toHaveTextContent('0');
    expect(metric('Total events')).toHaveAttribute('data-state', 'value');
  });

  it('accepts null unsaved config without inventing a saved disabled policy', () => {
    H.config = query(null);
    renderPage();
    expect(metric('Guard state')).toHaveAttribute('data-state', 'missing');
    expect(section('settings').getByText('No saved guard policy yet')).toBeInTheDocument();
    fireEvent.click(section('settings').getByRole('button', { name: 'Save settings' }));
    expect(H.setConfig.mutate).toHaveBeenCalledWith({
      vehicleId: 42, enabled: false, home_geofence_id: null, sensitivity: 'medium', auto_panic: false,
    });
  });

  it('treats verified false as off/unlocked and stale/unverified/null fields as unknown', () => {
    H.state = query(state({ state: { vehicle_id: 42, is_locked: false, sentry_mode: false } }));
    const view = renderPage();
    expect(metric('Sentry mode')).toHaveTextContent('Off');
    expect(metric('Lock state')).toHaveTextContent('Unlocked');
    H.state = query(state({ freshness: 'stale' }));
    view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}><GuardModePage /></QueryClientProvider></MemoryRouter>);
    expect(metric('Sentry mode')).toHaveAttribute('data-state', 'missing');
    expect(metric('Lock state')).toHaveAttribute('data-state', 'missing');
    expect(screen.queryByTestId('guard-map')).not.toBeInTheDocument();
  });

  it('does not coerce a verified but absent boolean into false', () => {
    H.state = query(state({ state: { vehicle_id: 42 } }));
    renderPage();
    expect(metric('Sentry mode')).toHaveAttribute('data-state', 'missing');
    expect(metric('Lock state')).toHaveAttribute('data-state', 'missing');
  });

  it('does not trust unverified fields despite a fresh stream and numeric coordinates', () => {
    H.state = query(state({ verifiedFields: [] }));
    renderPage();
    expect(metric('Sentry mode')).toHaveAttribute('data-state', 'missing');
    expect(metric('Lock state')).toHaveAttribute('data-state', 'missing');
    expect(screen.queryByTestId('guard-map')).not.toBeInTheDocument();
  });

  it('marks independent initial source loading without masking already available live fields', () => {
    H.events = query(undefined, { isLoading: true });
    H.config = query(undefined, { isLoading: true });
    renderPage();
    expect(metric('Total events')).toHaveTextContent('Updating…');
    expect(metric('Guard state')).toHaveTextContent('Updating…');
    expect(metric('Lock state')).toHaveTextContent('Locked');
    expect(section('events').queryByText('No guard events yet')).not.toBeInTheDocument();
  });

  it('retains independent geofence recovery while config is unavailable', () => {
    H.config = query(undefined, { isError: true, error: new Error('policy failed') });
    H.geofences = query([geofence], { isError: true, error: new Error('geofence refresh failed') });
    renderPage();
    fireEvent.click(section('settings').getByRole('button', { name: 'Refresh' }));
    expect(H.geofences.refetch).toHaveBeenCalledOnce();
    expect(H.config.refetch).not.toHaveBeenCalled();
  });

  it('retains history, policy and map during refresh errors with source-local recovery', () => {
    H.events = query([event()], { error: new Error('history refresh failed'), isError: true });
    H.config = query(config(), { error: new Error('policy refresh failed'), isError: true });
    H.state = query(state(), { error: new Error('state refresh failed'), isError: true });
    renderPage();
    expect(section('events').getByText('false → true')).toBeInTheDocument();
    expect(screen.getByTestId('guard-map')).toBeInTheDocument();
    expect(metric('Guard state')).toHaveTextContent('Triggered');
    fireEvent.click(section('events').getByRole('button', { name: 'Refresh' }));
    expect(H.events.refetch).toHaveBeenCalledTimes(1);
    expect(H.config.refetch).not.toHaveBeenCalled();
    expect(H.state.refetch).not.toHaveBeenCalled();
  });

  it('preserves saved auto-panic true on save and explicit false on save and arm/disarm', () => {
    renderPage();
    fireEvent.click(section('settings').getByRole('button', { name: 'Save settings' }));
    expect(H.setConfig.mutate).toHaveBeenLastCalledWith({
      vehicleId: 42, enabled: true, home_geofence_id: 5, sensitivity: 'high', auto_panic: true,
    });
    fireEvent.click(section('settings').getByRole('switch', { name: 'Auto-panic on trigger' }));
    fireEvent.click(section('settings').getByRole('button', { name: 'Save settings' }));
    expect(H.setConfig.mutate).toHaveBeenLastCalledWith({
      vehicleId: 42, enabled: true, home_geofence_id: 5, sensitivity: 'high', auto_panic: false,
    });
    fireEvent.click(section('arming').getByRole('switch', { name: 'Guard mode' }));
    expect(H.setConfig.mutate).toHaveBeenLastCalledWith({
      vehicleId: 42, enabled: false, home_geofence_id: 5, sensitivity: 'high', auto_panic: false,
    });
  });

  it('preserves draft sensitivity/geofence operands and reconciles untouched saved policy after arming failure', () => {
    const { result, rerender } = renderHook(() => useGuardPageModel());
    act(() => {
      result.current.setSensitivity('low');
      result.current.setHomeGeofenceId('9');
      result.current.setAutoPanic(false);
    });
    act(() => result.current.handleSaveSettings());
    expect(H.setConfig.mutate).toHaveBeenLastCalledWith({
      vehicleId: 42, enabled: true, home_geofence_id: 9, sensitivity: 'low', auto_panic: false,
    });
    H.config = query(config({ enabled: false }));
    H.setConfig.error = new Error('saved policy but arming failed');
    rerender();
    expect(result.current.policyEnabled).toBe(false);
    expect(result.current.effectiveAutoPanic).toBe(false);
    expect(result.current.effectiveSensitivity).toBe('low');
    expect(result.current.effectiveHomeGeofenceId).toBe('9');
  });

  it('requires panic confirmation and cancellation does not invoke the callback', () => {
    renderPage();
    const effects = 'This requests Sentry mode on, then horn honking, then light flashing. It does not lock doors, send notifications, or create a guard event. Commands can fail or complete only partially.';
    expect(section('panic').getByText(effects)).toBeInTheDocument();
    expect(section('panic').queryByText('Flash lights, honk horn, lock doors, enable sentry, and notify all channels')).not.toBeInTheDocument();
    fireEvent.click(section('panic').getByRole('button', { name: 'Activate panic' }));
    expect(H.panic.mutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(effects);
    expect(dialog).not.toHaveTextContent('send alerts to all notification channels');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(H.panic.mutate).not.toHaveBeenCalled();
    fireEvent.click(section('panic').getByRole('button', { name: 'Activate panic' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activate panic' }));
    expect(H.panic.mutate).toHaveBeenCalledWith(42);
  });

  it('retains unknown event types, transitions, attribution, timestamp and ack identity', () => {
    H.events = query([
      event({ event_type: 'future_security_event', from_state: null, to_state: '0' }),
      event({ id: 8, acknowledged_at: '2026-06-01T11:00:00Z', acknowledged_by: 'operator' }),
    ]);
    renderPage();
    expect(section('events').getByText('future_security_event')).toBeInTheDocument();
    expect(section('events').getByText('— → 0')).toBeInTheDocument();
    expect(section('events').getByText('Acknowledged by: operator')).toBeInTheDocument();
    expect(document.querySelector('[data-guard-event="7"] time')).toBeInTheDocument();
    fireEvent.click(section('events').getByRole('button', { name: 'Acknowledge event' }));
    expect(H.ack.mutate).toHaveBeenCalledWith({ vehicleId: 42, eventId: 7 });
  });

  it('does not label test alerts as triggered and never draws fictitious security event trails', () => {
    H.events = query([event({ event_type: 'test_alert' })]);
    renderPage();
    expect(metric('Guard state')).toHaveTextContent('Armed');
    expect(screen.queryByText('Guard alert triggered!')).not.toBeInTheDocument();
    expect(screen.queryByTestId('event-trail')).not.toBeInTheDocument();
    expect(screen.getByTestId('geofence-circle')).toHaveAttribute('data-radius', '100');
    expect(screen.getByText('Test vehicle')).toBeInTheDocument();
  });

  it('keeps disabled/pending states and mutation errors without automatically replaying commands', () => {
    H.setConfig.isPending = true;
    H.panic.isPending = true;
    H.ack.isPending = true;
    H.setConfig.error = new Error('arming failed after save');
    H.events = query([event()]);
    renderPage();
    expect(section('settings').getByRole('button', { name: /Save settings/ })).toBeDisabled();
    expect(section('arming').getByRole('switch', { name: 'Guard mode' })).toBeDisabled();
    expect(section('events').getByRole('button', { name: 'Acknowledge event' })).toBeDisabled();
    expect(section('panic').getByRole('button', { name: /Sending/ })).toBeDisabled();
    expect(section('arming').getByText(/Policy may have been saved even if arming failed/)).toBeInTheDocument();
    expect(H.setConfig.mutate).not.toHaveBeenCalled();
  });

  it('leaves manual panic reachable with an unavailable policy, but guards invalid vehicle commands', () => {
    H.config = query(undefined, { isError: true, error: new Error('policy failed') });
    const view = renderPage();
    expect(section('panic').getByRole('button', { name: 'Activate panic' })).not.toBeDisabled();
    H.vehicleId = 0;
    view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}><GuardModePage /></QueryClientProvider></MemoryRouter>);
    expect(section('panic').getByRole('button', { name: 'Activate panic' })).toBeDisabled();
    expect(screen.getByText('Select a vehicle in the workspace header to load guard data.')).toBeInTheDocument();
    expect(H.panic.mutate).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'zero latitude', latitude: 0, longitude: -121.9 },
    { label: 'zero longitude', latitude: 37.5, longitude: 0 },
    { label: 'both zero', latitude: 0, longitude: 0 },
    { label: 'positive geographic boundaries', latitude: 90, longitude: 180 },
    { label: 'negative geographic boundaries', latitude: -90, longitude: -180 },
  ])('renders verified finite $label coordinates without changing their values', ({ latitude, longitude }) => {
    H.state = query(state({ state: { vehicle_id: 42, latitude, longitude } }));
    renderPage();
    expect(screen.getByTestId('guard-map')).toHaveAttribute('data-latitude', String(latitude));
    expect(screen.getByTestId('guard-map')).toHaveAttribute('data-longitude', String(longitude));
    expect(H.setConfig.mutate).not.toHaveBeenCalled();
    expect(H.panic.mutate).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'missing latitude', latitude: undefined, longitude: 0 },
    { label: 'missing longitude', latitude: 0, longitude: undefined },
    { label: 'null latitude', latitude: null, longitude: 0 },
    { label: 'null longitude', latitude: 0, longitude: null },
    { label: 'both null', latitude: null, longitude: null },
    { label: 'NaN latitude', latitude: Number.NaN, longitude: 0 },
    { label: 'NaN longitude', latitude: 0, longitude: Number.NaN },
    { label: 'infinite latitude', latitude: Number.POSITIVE_INFINITY, longitude: 0 },
    { label: 'negative infinite longitude', latitude: 0, longitude: Number.NEGATIVE_INFINITY },
    { label: 'latitude above range', latitude: 90.001, longitude: 0 },
    { label: 'latitude below range', latitude: -90.001, longitude: 0 },
    { label: 'longitude above range', latitude: 0, longitude: 180.001 },
    { label: 'longitude below range', latitude: 0, longitude: -180.001 },
  ])('rejects $label rather than inventing or coercing a location', ({ latitude, longitude }) => {
    H.state = query(state({ state: { vehicle_id: 42, latitude, longitude } }));
    renderPage();
    expect(screen.queryByTestId('guard-map')).not.toBeInTheDocument();
    expect(section('map').getByText('Current vehicle location unavailable')).toBeInTheDocument();
  });

  it.each(['stale', 'unverified'] as const)('does not let valid zeros bypass %s source trust', condition => {
    H.state = query(state({
      state: { vehicle_id: 42, latitude: 0, longitude: 0 },
      freshness: condition === 'stale' ? 'stale' : 'fresh',
      verifiedFields: condition === 'unverified' ? [] : ['latitude', 'longitude'],
    }));
    renderPage();
    expect(screen.queryByTestId('guard-map')).not.toBeInTheDocument();
  });

  it('rejects incorrectly typed coordinates without treating the string zero as measured zero', () => {
    // Deliberately corrupted wire input: the real typed DTO permits only numbers/null.
    H.state = query(state({ state: { vehicle_id: 42, latitude: '0' as unknown as number, longitude: 0 } }));
    renderPage();
    expect(screen.queryByTestId('guard-map')).not.toBeInTheDocument();
  });

  it('preserves an untouched loaded geofence on Save, but explicit clear sends null on Save and arm/disarm', () => {
    renderPage();
    const select = section('settings').getByRole('combobox', { name: 'Home geofence' });
    expect(select).toHaveValue('5');
    fireEvent.click(section('settings').getByRole('button', { name: 'Save settings' }));
    expect(H.setConfig.mutate).toHaveBeenLastCalledWith({
      vehicleId: 42, enabled: true, home_geofence_id: 5, sensitivity: 'high', auto_panic: true,
    });
    fireEvent.change(select, { target: { value: '' } });
    expect(select).toHaveValue('');
    expect(screen.queryByTestId('geofence-circle')).not.toBeInTheDocument();
    fireEvent.click(section('settings').getByRole('button', { name: 'Save settings' }));
    expect(H.setConfig.mutate).toHaveBeenLastCalledWith({
      vehicleId: 42, enabled: true, home_geofence_id: null, sensitivity: 'high', auto_panic: true,
    });
    fireEvent.click(section('arming').getByRole('switch', { name: 'Guard mode' }));
    expect(H.setConfig.mutate).toHaveBeenLastCalledWith({
      vehicleId: 42, enabled: false, home_geofence_id: null, sensitivity: 'high', auto_panic: true,
    });
  });

  it('follows loaded/refreshed config only while the geofence draft is untouched', () => {
    H.config = query(undefined, { isLoading: true });
    const { result, rerender } = renderHook(() => useGuardPageModel());
    expect(result.current.effectiveHomeGeofenceId).toBe('');
    H.config = query(config({ home_geofence_id: 5 }));
    rerender();
    expect(result.current.effectiveHomeGeofenceId).toBe('5');
    H.config = query(config({ home_geofence_id: 9 }));
    rerender();
    expect(result.current.effectiveHomeGeofenceId).toBe('9');
    act(() => result.current.handleSaveSettings());
    expect(H.setConfig.mutate).toHaveBeenLastCalledWith({
      vehicleId: 42, enabled: true, home_geofence_id: 9, sensitivity: 'high', auto_panic: true,
    });
    H.config = query(config({ home_geofence_id: null }));
    rerender();
    expect(result.current.effectiveHomeGeofenceId).toBe('');
    H.config = query(config({ home_geofence_id: 5 }));
    rerender();
    expect(result.current.effectiveHomeGeofenceId).toBe('5');
    act(() => result.current.setHomeGeofenceId('9'));
    H.config = query(config({ home_geofence_id: 5 }));
    rerender();
    expect(result.current.effectiveHomeGeofenceId).toBe('9');
    expect(H.setConfig.mutate).toHaveBeenCalledTimes(1);
  });

  it('keeps an explicit clear through pending failure and config refetch without replaying a command', () => {
    const view = renderPage();
    fireEvent.change(section('settings').getByRole('combobox', { name: 'Home geofence' }), { target: { value: '' } });
    fireEvent.click(section('settings').getByRole('button', { name: 'Save settings' }));
    expect(H.setConfig.mutate).toHaveBeenCalledTimes(1);
    expect(H.setConfig.mutate).toHaveBeenLastCalledWith({
      vehicleId: 42, enabled: true, home_geofence_id: null, sensitivity: 'high', auto_panic: true,
    });
    H.setConfig.isPending = true;
    H.config = query(config({ home_geofence_id: 5 }), { isFetching: true });
    view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}><GuardModePage /></QueryClientProvider></MemoryRouter>);
    expect(section('settings').getByRole('combobox', { name: 'Home geofence' })).toHaveValue('');
    expect(section('settings').getByRole('button', { name: /Save settings/ })).toBeDisabled();
    H.setConfig.isPending = false;
    H.setConfig.error = new Error('arming failed after saved policy');
    H.config = query(config({ home_geofence_id: null }));
    view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}><GuardModePage /></QueryClientProvider></MemoryRouter>);
    expect(section('settings').getByRole('combobox', { name: 'Home geofence' })).toHaveValue('');
    H.config = query(config({ home_geofence_id: 5 }), { isError: true, error: new Error('refresh failed') });
    view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}><GuardModePage /></QueryClientProvider></MemoryRouter>);
    expect(section('settings').getByRole('combobox', { name: 'Home geofence' })).toHaveValue('');
    expect(H.setConfig.mutate).toHaveBeenCalledTimes(1);
    fireEvent.click(section('settings').getByRole('button', { name: 'Save settings' }));
    expect(H.setConfig.mutate).toHaveBeenCalledTimes(2);
    expect(H.setConfig.mutate).toHaveBeenLastCalledWith({
      vehicleId: 42, enabled: true, home_geofence_id: null, sensitivity: 'high', auto_panic: true,
    });
  });
});
