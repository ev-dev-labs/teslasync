import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargingSession, ChargingTelemetry } from '@/api/types';
import type { EnergyStats } from '@/types/energy';
import { ToastProvider } from '@/components/feedback';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

const mocks = vi.hoisted(() => ({
  energy: vi.fn(), health: vi.fn(), sessions: vi.fn(), live: vi.fn(), idle: vi.fn(),
}));
vi.mock('@/api/hooks/useEnergy', () => ({
  useEnergyStats: mocks.energy, useBatteryHealthAnalytics: mocks.health, useVampireDrainStats: mocks.idle,
}));
vi.mock('@/api/hooks/useCharging', () => ({ useChargingSessionsPaginated: mocks.sessions }));
vi.mock('@/api/hooks/useVehicles', () => ({ useChargingTelemetryLatest: mocks.live }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({ start: '2025-06-01', end: '2025-06-30' }),
}));
vi.mock('@/hooks/useLiveConnection', () => ({ useLiveConnection: () => ({ status: 'connected' }) }));
vi.mock('@/components/ai/AIBatteryHealthForecastNarrative', () => ({
  AIBatteryHealthForecastNarrative: ({ vehicleId }: { vehicleId?: number }) =>
    <div data-testid="test-ai-vehicle-scope" data-vehicle-id={vehicleId} />,
}));
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [], isLoading: false }),
  useCreateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
}));

import EnergyPage from '../../pages/EnergyPage';
import BatteryHealthPage from '../../pages/BatteryHealthPage';

function query<T>(data: T | undefined, options: { loading?: boolean; error?: Error; refetch?: () => void } = {}) {
  return {
    data, isLoading: options.loading ?? false, isPending: options.loading ?? false,
    isFetching: false, isError: Boolean(options.error), isSuccess: !options.loading && !options.error,
    error: options.error ?? null, dataUpdatedAt: data === undefined ? 0 : Date.now(),
    refetch: options.refetch ?? vi.fn(),
  };
}

const session: ChargingSession = {
  id: 101, vehicle_id: 7, started_at: '2025-06-01T02:00:00Z', ended_at: '2025-06-01T03:00:00Z',
  start_soc_pct: 20, end_soc_pct: 60, delta_soc_pct: 40,
  start_odometer_m: null, end_odometer_m: null, start_lat: null, start_lng: null, start_place: null,
  total_energy_added_wh: 10000, peak_power_w: 50000, avg_power_w: 40000,
  cost_decimal: 2, cost_currency: 'USD', charger_type: 'CCS', cable_type: null,
  startedAt: '2025-06-01T02:00:00Z', duration_min: 60,
};
const stats: EnergyStats = {
  vehicle_id: 7, period_days: 30, total_energy_used_wh: 36000, total_energy_charged_wh: 10000,
  total_wh: 10000, total_cost: 2, total_distance_m: 200000,
  avg_efficiency_wh_per_m: 0.18, co2_saved_kg: 14.4,
  daily_breakdown: [
    { date: '2025-06-01', energy_wh: 36000, distance_m: 200000, efficiency_wh_per_m: 0.18, cost: 2 },
    { date: '2025-07-01', energy_wh: 999999, distance_m: 999999, efficiency_wh_per_m: 0.4, cost: 999 },
  ],
};
const live: ChargingTelemetry = {
  vehicle_id: 7, ts: '2025-06-30T12:00:00Z', session_id: null,
  battery_level: null, battery_range_mi: null, charging_state: null, charger_voltage: null,
  charger_actual_current: null, charger_power_w: null, charger_phases: null, charge_energy_added_wh: null,
  range_added_meters: null, range_added_meters_per_hour: null, charger_pilot_current: null,
  scheduled_charging_at: null, source: 'test-only', module_temp_max: 42,
  module_temp_min: 32, battery_heater_on: false, lifetime_energy_used: 125.5, bms_fullcharge_complete: false,
};

function mount(page: ReactNode, route: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[route]}><ToastProvider>{page}</ToastProvider></MemoryRouter>
  </QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  mocks.energy.mockReturnValue(query(stats));
  mocks.sessions.mockReturnValue(query([session]));
  mocks.live.mockReturnValue(query(live));
  mocks.health.mockReturnValue(query(undefined));
  mocks.idle.mockReturnValue(query({ avg_drain_pct_per_day: 0.3 }));
});
afterEach(cleanup);

describe('live battery pages: independent sources and preserved orchestration', () => {
  it('keeps Energy outline, charging table and lifetime values during initial drive loading', async () => {
    const pendingDrive = query(undefined, { loading: true });
    mocks.energy.mockReturnValue(pendingDrive);
    const { container } = mount(<EnergyPage />, '/energy');
    expect(screen.getByRole('heading', { level: 1, name: 'Energy intelligence' })).toBeVisible();
    for (const title of [
      'Efficiency driver investigation', 'Efficiency & cost overview', 'Lifetime metrics',
      'Energy & cost daily', 'Efficiency trend', 'Charging by time of day',
      'Charger type breakdown', 'Recent charging sessions',
    ]) expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    const overview = screen.getByRole('region', { name: 'Energy overview' });
    const lifetime = within(overview).getByRole('heading', { name: 'Lifetime metrics' }).closest('[data-battery-panel]');
    if (!(lifetime instanceof HTMLElement)) throw new Error('The independent lifetime panel is missing');
    expect(lifetime).toHaveAttribute('data-battery-panel', 'energy-lifetime');
    // FadeIn's real entrance begins at opacity 0 (50 ms delay + 400 ms
    // transition). Await visibility rather than accepting hidden source content.
    await waitFor(() => {
      expect(within(lifetime).getByText('125.50')).toBeVisible();
      expect(container.querySelector('a[href="/charging/101"]')).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Recent charging sessions' })).toBeVisible();
    }, { timeout: 2_000 });
    expect(pendingDrive.isLoading).toBe(true);
    expect(pendingDrive.data).toBeUndefined();
    expect(container.querySelector('[data-role="page-container"]')).toHaveAttribute('aria-busy', 'true');
    expect(mocks.energy).toHaveBeenCalledWith('7', { start: '2025-06-01' });
    expect(mocks.sessions).toHaveBeenCalledWith(7, { limit: 100, start: '2025-06-01', end: '2025-06-30' });
    expect(mocks.idle).toHaveBeenCalledWith('7');
    expect(container.querySelectorAll('[data-layout-reference]')).toHaveLength(1);
  });

  it('keeps end-filtered distance/cost denominator values and all six specialist KPI identities', () => {
    const { container } = mount(<EnergyPage />, '/energy');
    const summary = screen.getByTestId('energy-summary');
    expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(within(summary).getByText('200 km')).toBeVisible();
    expect(within(summary).getByText('Cost per km')).toBeVisible();
    expect(within(summary).getByText('$0.01')).toBeVisible();
    expect(within(summary).getByText('$0.20')).toBeVisible();
    expect(container.querySelectorAll('[data-battery-panel]')).toHaveLength(8);
  });

  it('keeps the table and charging pattern child content through a failed cached refresh', () => {
    const retry = vi.fn();
    mocks.sessions.mockReturnValue(query([session], { error: new Error('Cached test refresh failed'), refetch: retry }));
    const { container } = mount(<EnergyPage />, '/energy');
    expect(container.querySelector('a[href="/charging/101"]')).not.toBeNull();
    expect(screen.getByText('Buckets use UTC session start time.')).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).not.toHaveLength(0);
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: /refresh/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each(['loading', 'empty', 'error'] as const)('keeps the complete health outline, live telemetry and actions while the model is %s', state => {
    const retry = vi.fn();
    mocks.health.mockReturnValue(query(undefined, {
      loading: state === 'loading', error: state === 'error' ? new Error('Model test failure') : undefined, refetch: retry,
    }));
    const { container } = mount(<BatteryHealthPage />, '/battery');
    expect(screen.getByTestId('battery-health-unavailable-outline')).toBeInTheDocument();
    expect(screen.getByTestId('battery-operational-brief')).toBeInTheDocument();
    expect(screen.getByTestId('battery-glossary-strip')).toBeInTheDocument();
    expect(screen.getByText('42.00 °C')).toBeVisible();
    expect(screen.getByText('Off')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Battery Cells' })).toHaveAttribute('href', '/battery-cells');
    expect(screen.getByTestId('test-ai-vehicle-scope')).toHaveAttribute('data-vehicle-id', '7');
    expect(container.querySelectorAll('[data-battery-panel]')).toHaveLength(11);
    expect(screen.getByTestId('battery-health-summary').querySelectorAll('[data-operational-metric]')).toHaveLength(7);
    expect(mocks.health).toHaveBeenCalledWith('7');
    expect(mocks.live).toHaveBeenCalledWith(7);
    if (state === 'error') {
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(retry).toHaveBeenCalledTimes(1);
    }
  });
});
