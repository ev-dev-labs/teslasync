import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { SecurityEvent } from '@/api/types';
import type { SafetySnapshot } from '@/types/vehicle-systems';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { ApiError } from '@/lib/resilience';

type Source<T> = DataStateSource<T> & { refetch: ReturnType<typeof vi.fn> };
const H = vi.hoisted(() => ({
  latest: {} as Source<SafetySnapshot>,
  history: {} as Source<SafetySnapshot[]>,
  security: {} as Source<SecurityEvent>,
}));

vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: vi.fn(() => Promise.reject(new Error('Unexpected request in safety presentation test'))),
}));
vi.mock('@/hooks/useSelectedVehicle', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSelectedVehicle')>(),
  useSelectedVehicle: () => ({ vehicleId: 42, vehicle: null, vehicles: [] }),
}));
vi.mock('@/api/hooks/useVehicleSystems', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useVehicleSystems')>(),
  useSafety: () => H.latest,
  useSafetyHistory: () => H.history,
}));
vi.mock('@/api/hooks/useVehicles', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useVehicles')>(),
  useSecurityLatest: () => H.security,
}));
vi.mock('@/components/motion', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// Only unmeasurable plotting primitives are replaced. Frames, gauge, source
// recovery, stats, cards, KVList and DataTable are the shipping implementations.
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const none = () => null;
  return {
    ...actual,
    ResponsiveContainer: pass,
    LineChart: ({ children, data }: { children?: ReactNode; data: unknown }) =>
      <div data-testid="safety-plot-points" data-points={JSON.stringify(data)}>{children}</div>,
    Line: none, XAxis: none, YAxis: none, Tooltip: none,
    ChartLegend: none, ChartTooltip: none, chartGrid: null,
  };
});

import SafetySettingsPage from '../../pages/SafetySettingsPage';

const settings: SafetySnapshot = {
  id: 7, vehicle_id: 42, created_at: '2026-10-04T12:00:00Z',
  automatic_emergency_braking_off: false, automatic_blind_spot_camera: true,
  blind_spot_collision_warning: false, emergency_lane_departure_avoidance: true,
  pin_to_drive_enabled: false, forward_collision_warning: 'ForwardCollisionSensitivityHigh',
  lane_departure_avoidance: 'LaneAssistLevelWarning',
  speed_limit_warning: 'SpeedAssistLevelNone', cruise_follow_distance: 'FollowDistance3',
  miles_since_reset: 0, self_driving_miles_since_reset: null,
};
const security: SecurityEvent = {
  vehicle_id: 42, ts: '2026-10-04T12:01:00Z', created_at: '2026-10-04T12:01:00Z',
  event_type: 'state', source: 'telemetry', doors_open: null, windows_open: null,
  locked: false, sentry_mode: null, user_present: null, detail: null,
  driver_seat_belt: true, passenger_seat_belt: false, driver_seat_occupied: null,
};
function query<T>(data: T | undefined, overrides: Partial<Source<T>> = {}): Source<T> {
  return {
    data, error: null, isError: false, isSuccess: true, isPending: false,
    isLoading: false, isFetching: false, isStale: false, fetchStatus: 'idle',
    dataUpdatedAt: Date.now(), refetch: vi.fn(), ...overrides,
  };
}
function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => <MemoryRouter initialEntries={['/safety-settings']}>
    <QueryClientProvider client={client}><SafetySettingsPage /></QueryClientProvider>
  </MemoryRouter>;
  const view = render(ui());
  return { ...view, refreshView: () => view.rerender(ui()) };
}
function panel(title: string) {
  const heading = screen.getByRole('heading', { name: title, exact: true });
  const element = heading.closest<HTMLElement>('[data-card]');
  if (!element) throw new Error(`Missing canonical safety card: ${title}`);
  return element;
}
function statValue(label: string) {
  const labelNode = within(panel('Safety summary')).getByText(label, { selector: '[data-operational-metric] > div:first-child > :first-child' });
  const tile = labelNode.closest<HTMLElement>('[data-operational-metric]');
  if (!tile) throw new Error(`Missing safety stat: ${label}`);
  return tile.querySelector('[data-operational-value]')?.textContent;
}
function signalValue(label: string) {
  const labelNode = within(panel('Live safety signals')).getByText(label, { selector: 'dt *' });
  const list = labelNode.closest('dl');
  if (!list) throw new Error(`Missing live signal list: ${label}`);
  return list.querySelector('dd')?.textContent;
}
beforeEach(() => {
  vi.clearAllMocks();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  H.latest = query(settings);
  H.history = query([settings]);
  H.security = query(security);
});
afterEach(cleanup);

describe('safety closure with real source, configuration and live components', () => {
  it('retains reported settings when live permission fails, then recovers false/null signals independently', () => {
    H.security = query<SecurityEvent>(undefined, {
      isSuccess: false, isError: true, error: new ApiError('Security denied', 403, 'PERMISSION_DENIED'),
    });
    const view = mountPage();
    expect(within(panel('Live safety signals')).getByText('Permission denied')).toBeInTheDocument();
    expect(within(panel('Live safety signals')).queryByRole('button', { name: 'Retry' }))
      .not.toBeInTheDocument();
    expect(statValue('Total features')).toBe('9');
    expect(statValue('Unknown')).toBe('0');
    expect(screen.getByRole('meter', { name: 'Enabled feature share' }))
      .toHaveAttribute('aria-valuenow', '6');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(within(panel('Driving statistics')).getByText('0.00 km')).toBeInTheDocument();
    expect(within(panel('Driving statistics')).getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save settings|apply settings/i })).not.toBeInTheDocument();

    H.security = query(security);
    view.refreshView();
    expect(within(panel('Live safety signals')).queryByText('Permission denied')).not.toBeInTheDocument();
    expect(signalValue('Driver belt')).toBe('Buckled');
    expect(signalValue('Passenger belt')).toBe('Unbuckled');
    expect(signalValue('Driver seat')).toBe('—');
    expect(signalValue('Vehicle lock')).toBe('Unlocked');
    expect(statValue('Total features')).toBe('9');
    expect(H.latest.refetch).not.toHaveBeenCalled();
    expect(H.history.refetch).not.toHaveBeenCalled();
    expect(H.security.refetch).not.toHaveBeenCalled();
  });

  it('keeps live false readings during independent initial configuration loading and history failure/recovery', () => {
    H.latest = query<SafetySnapshot>(undefined, {
      isPending: true, isLoading: true, isSuccess: false, fetchStatus: 'fetching',
    });
    H.history = query<SafetySnapshot[]>(undefined, {
      isSuccess: false, isError: true, error: new Error('History unavailable'),
    });
    const failedHistory = H.history;
    const view = mountPage();
    expect(signalValue('Passenger belt')).toBe('Unbuckled');
    expect(signalValue('Vehicle lock')).toBe('Unlocked');
    expect(screen.queryByRole('meter', { name: 'Enabled feature share' })).not.toBeInTheDocument();
    expect(within(panel('Safety summary')).queryByText('Total features')).not.toBeInTheDocument();
    fireEvent.click(within(panel('Safety settings history')).getByRole('button', { name: 'Retry' }));
    expect(failedHistory.refetch).toHaveBeenCalledOnce();
    expect(H.latest.refetch).not.toHaveBeenCalled();
    expect(H.security.refetch).not.toHaveBeenCalled();

    H.history = query([settings]);
    view.refreshView();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(signalValue('Vehicle lock')).toBe('Unlocked');
    expect(within(panel('ADAS features')).queryByText('Requires PIN before driving'))
      .not.toBeInTheDocument();
    H.latest = query({ ...settings, automatic_emergency_braking_off: null });
    view.refreshView();
    expect(statValue('Unknown')).toBe('1');
    expect(statValue('Enabled feature share')).toBe('—');
    expect(screen.queryByRole('meter', { name: 'Enabled feature share' })).not.toBeInTheDocument();
    expect(within(panel('Configuration coverage')).getByText('Feature share unavailable: some settings are unknown.'))
      .toBeInTheDocument();
    expect(within(panel('Auto emergency braking')).getByText('Unknown')).toBeInTheDocument();
    expect(signalValue('Vehicle lock')).toBe('Unlocked');
  });

  it('keeps paused settings and failed-refresh history while only live recovery is retried and updated', () => {
    H.latest = query(settings, { fetchStatus: 'paused' });
    H.history = query([settings], { isError: true, error: new Error('History refresh failed') });
    H.security = query(security, { isError: true, error: new Error('Security refresh failed') });
    const latestSource = H.latest;
    const historySource = H.history;
    const securitySource = H.security;
    const view = mountPage();
    expect(document.querySelector('[data-testid="safety-configuration-summary"]')?.parentElement)
      .toHaveAttribute('data-source-retained', 'true');
    expect(within(panel('Safety settings history')).getByRole('table')).toBeInTheDocument();
    expect(within(panel('Live safety signals')).getByText(/Previously loaded data remains visible/))
      .toHaveTextContent(/Previously loaded data remains visible.*Live safety signals/);
    expect(signalValue('Vehicle lock')).toBe('Unlocked');
    fireEvent.click(within(panel('Live safety signals')).getByRole('button', { name: 'Retry' }));
    expect(securitySource.refetch).toHaveBeenCalledOnce();
    expect(latestSource.refetch).not.toHaveBeenCalled();
    expect(historySource.refetch).not.toHaveBeenCalled();

    H.security = query({ ...security, locked: true, passenger_seat_belt: null, driver_seat_occupied: false });
    view.refreshView();
    expect(signalValue('Vehicle lock')).toBe('Locked');
    expect(signalValue('Passenger belt')).toBe('—');
    expect(signalValue('Driver seat')).toBe('Empty');
    expect(within(panel('Live safety signals')).queryByText(/Previously loaded data remains visible/))
      .not.toBeInTheDocument();
    expect(within(panel('Safety settings history')).getByText(/History refresh failed/))
      .toBeInTheDocument();
    expect(document.querySelector('[data-testid="safety-configuration-summary"]')?.parentElement)
      .toHaveAttribute('data-source-retained', 'true');
    expect(statValue('Enabled')).toBe('6');
  });
});
