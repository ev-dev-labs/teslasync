import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useVaultEvidence } from './useVaultEvidence';

const requestMock = vi.fn();
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

function makeWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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
  if (path === '/tesla/warranty') return { data: { plan: 'Basic' }, fetched_at: '2024-01-01T00:00:00Z' };
  if (path.startsWith('/drives/score')) return { overall: 90, efficiency: 90, smoothness: 90, speedDiscipline: 90, grade: 'A', totalDrives: 1, trend: 'up' };
  if (path.startsWith('/drives/stats')) return { totalDrives: 1, totalDistanceKm: 10, totalDurationS: 600, avgEfficiencyWhKm: 150, avgSpeedKmh: 40, topSpeedKmh: 80, regenRatio: 0.1, regenEnergyWh: 100, co2SavedKg: 1 };
  if (path.startsWith('/drives')) return [];
  if (path.startsWith('/charging-sessions')) return [];
  if (path.includes('/guard/events')) return { vehicle_id: 1, events: [] };
  return null;
}

describe('useVaultEvidence', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation((path: string) => Promise.resolve(routeResponse(path)));
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
});
