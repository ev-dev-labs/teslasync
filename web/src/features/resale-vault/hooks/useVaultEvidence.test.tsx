import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useVaultEvidence } from './useVaultEvidence';

const requestMock = vi.fn();
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function routeResponse(path: string): unknown {
  if (/^\/vehicles\/\d+$/.test(path)) {
    return {
      id: 1, vehicle_id: 1, vin: '5YJ3E1EA7KF123456', display_name: 'My Model 3', model: 'Model 3',
      trim_badging: 'LR', exterior_color: 'White', wheel_type: 'Aero', state: 'online', healthy: true,
      created_at: '2022-01-01T00:00:00Z', updated_at: '2022-01-01T00:00:00Z',
    };
  }
  if (path.includes('/battery-passport')) {
    return {
      vehicle_id: 1, vin_masked: '5YJ•••3456', issued_at: '2024-01-01T00:00:00Z', first_observed_at: '2022-01-01T00:00:00Z',
      soh_pct: 95, capacity_kwh: 74, original_capacity_kwh: 75, equivalent_full_cycles: 100, fast_charge_ratio: 0.1,
      avg_charge_limit_pct: 80, thermal_exposure: { cold_pct: 10, nominal_pct: 80, hot_pct: 10 }, health_grade: 'A',
      degradation_trend: [], recommendations: [], provenance_hash: 'abc',
    };
  }
  if (path.startsWith('/maintenance/records')) return [];
  if (path.startsWith('/maintenance')) return [];
  if (path.startsWith('/software-updates')) return [];
  if (path === '/vehicles/1/warranty') return { data: { plan: 'Basic' }, fetched_at: '2024-01-01T00:00:00Z' };
  if (path.startsWith('/drives/score')) return { overall: 90, efficiency: 90, smoothness: 90, speedDiscipline: 90, grade: 'A', totalDrives: 1, trend: 'up' };
  if (path.startsWith('/drives/stats')) return { totalDrives: 1, totalDistanceKm: 10, totalDurationS: 600, avgEfficiencyWhKm: 150, avgSpeedKmh: 40, topSpeedKmh: 80, regenRatio: 0.1, regenEnergyWh: 100, co2SavedKg: 1 };
  if (path.startsWith('/drives')) return [];
  if (path.startsWith('/charging-sessions')) return [];
  if (path.includes('/guard/events')) return { vehicle_id: 1, events: [] };
  return null;
}

describe('useVaultEvidence', () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
    requestMock.mockReset();
    requestMock.mockImplementation((path: string) => Promise.resolve(routeResponse(path)));
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('keeps active first reads initial without inventing empty evidence or failures', async () => {
    let resolveBattery!: (value: unknown) => void;
    requestMock.mockImplementation((path: string) =>
      path.includes('/battery-passport')
        ? new Promise((resolve) => { resolveBattery = resolve; })
        : Promise.resolve(routeResponse(path)),
    );
    const { result } = renderHook(
      () => useVaultEvidence('1', { vinDisclosure: 'excluded', exactTimestamps: false }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.sources.find((source) => source.id === 'vehicle')?.state.status).toBe('ok'));
    expect(result.current.sources.find((source) => source.id === 'battery')).toMatchObject({
      loading: true,
      state: { status: 'initial', hasData: false, isRefreshBlocked: false, fatalError: null, refreshError: null },
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasPartialErrors).toBe(false);
    expect(result.current.evidence.battery).toBeNull();

    await act(async () => { resolveBattery(routeResponse('/vehicles/1/battery-passport')); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.evidence.battery?.capacity_wh).toBeCloseTo(74000);
  });

  it('keeps paused first reads pending with a blocked state, then recovers without a fabricated error', async () => {
    onlineManager.setOnline(false);
    const { result } = renderHook(
      () => useVaultEvidence('1', { vinDisclosure: 'excluded', exactTimestamps: false }),
      { wrapper: makeWrapper() },
    );

    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.hasPartialErrors).toBe(false);
    expect(result.current.evidence.battery).toBeNull();
    for (const source of result.current.sources) {
      expect(source).toMatchObject({
        loading: true,
        state: { status: 'initial', hasData: false, isRefreshBlocked: true, provenance: 'unknown', fatalError: null, refreshError: null },
      });
    }

    act(() => { onlineManager.setOnline(true); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sources.every((source) => source.state.status === 'ok' && !source.state.isRefreshBlocked)).toBe(true);
  });

  it('preserves successful empty collections and measured zero as resolved data', async () => {
    requestMock.mockImplementation((path: string) => Promise.resolve(
      path.startsWith('/drives/stats') ? { totalDrives: 0, totalDistanceKm: 0, totalDurationS: 0 } : routeResponse(path),
    ));
    const { result } = renderHook(
      () => useVaultEvidence('1', { vinDisclosure: 'excluded', exactTimestamps: false }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sources.find((source) => source.id === 'maintenance')).toMatchObject({
      loading: false, state: { data: [], hasData: true, status: 'ok', fatalError: null },
    });
    expect(result.current.sources.find((source) => source.id === 'driving-stats')).toMatchObject({
      loading: false, state: { data: { totalDrives: 0, totalDurationS: 0 }, hasData: true, status: 'ok' },
    });
    expect(result.current.evidence.driving_history?.total_duration_s).toBe(0);
    expect(result.current.hasPartialErrors).toBe(false);
  });

  it('distinguishes an initial failure from a successful empty source', async () => {
    requestMock.mockImplementation((path: string) =>
      path.includes('/battery-passport') ? Promise.reject(new Error('battery denied')) : Promise.resolve(routeResponse(path)),
    );
    const { result } = renderHook(
      () => useVaultEvidence('1', { vinDisclosure: 'excluded', exactTimestamps: false }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sources.find((source) => source.id === 'battery')).toMatchObject({
      loading: false,
      state: { status: 'initialFailure', hasData: false, fatalError: new Error('battery denied'), refreshError: null },
    });
    expect(result.current.sources.find((source) => source.id === 'maintenance')?.state.status).toBe('ok');
    expect(result.current.hasPartialErrors).toBe(true);
    expect(result.current.evidence.battery).toBeNull();
  });

  it('composes evidence from all reused hooks without introducing any new endpoint', async () => {
    const { result } = renderHook(
      () => useVaultEvidence('1', { vinDisclosure: 'excluded', exactTimestamps: false }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.evidence.vehicle_identity).not.toBeNull();
    expect(result.current.evidence.vehicle_identity?.vin_full).toBeNull();
    expect(result.current.evidence.battery?.capacity_wh).toBeCloseTo(74000);
    expect(result.current.evidence.warranty?.data).toEqual({ plan: 'Basic' });
    expect(result.current.evidence.driving_history?.total_duration_s).toBe(600);
    expect(result.current.hasPartialErrors).toBe(false);
  });

  it('returns null vehicleId gracefully (no vehicle selected yet)', async () => {
    const { result } = renderHook(
      () => useVaultEvidence(null, { vinDisclosure: 'excluded', exactTimestamps: false }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.evidence.vehicle_identity).toBeNull();
  });

  it('keeps normalized evidence and identifies only the affected retained source after refresh failure', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useVaultEvidence('1', { vinDisclosure: 'excluded', exactTimestamps: false }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.evidence.battery?.capacity_wh).toBeCloseTo(74000);

    requestMock.mockImplementation((path: string) =>
      path.includes('/battery-passport')
        ? Promise.reject(new Error('battery refresh failed'))
        : Promise.resolve(routeResponse(path)),
    );
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => expect(result.current.sources.find((source) => source.id === 'battery')?.state.status).toBe('stale'));

    expect(result.current.evidence.battery?.capacity_wh).toBeCloseTo(74000);
    expect(result.current.evidence.vehicle_identity?.vin_full).toBeNull();
    expect(result.current.sources.find((source) => source.id === 'vehicle')?.state.status).toBe('ok');
    expect(result.current.hasPartialErrors).toBe(true);
    expect(result.current.sources).toHaveLength(11);
    expect(result.current.sources.find((source) => source.id === 'battery')).toMatchObject({
      loading: false, state: { hasData: true, fatalError: null, refreshError: new Error('battery refresh failed') },
    });
    expect(result.current.isLoading).toBe(false);

    requestMock.mockImplementation((path: string) => Promise.resolve(routeResponse(path)));
    await act(async () => { result.current.sources.find((source) => source.id === 'battery')?.state.retry?.(); });
    await waitFor(() => expect(result.current.sources.find((source) => source.id === 'battery')?.state.status).toBe('ok'));
    expect(result.current.sources.find((source) => source.id === 'battery')?.state.refreshError).toBeNull();
    expect(result.current.hasPartialErrors).toBe(false);
    expect(result.current.evidence.battery?.capacity_wh).toBeCloseTo(74000);
  });
});
