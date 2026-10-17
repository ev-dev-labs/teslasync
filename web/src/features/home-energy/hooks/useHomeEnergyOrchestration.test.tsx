import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { FleetStateEntry } from '@/api/hooks/useVehicles';
import type { Vehicle } from '@/types/vehicle';
import { useHomeEnergyOrchestration } from './useHomeEnergyOrchestration';
import { optimizeHomeEnergy } from '../lib/optimizer';

const sources = vi.hoisted(() => ({
  vehicles: {} as DataStateSource<Vehicle[]>,
  fleet: {} as DataStateSource<FleetStateEntry[]>,
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/hooks/useVehicles')>(),
  useVehicles: () => sources.vehicles,
  useFleetStates: () => sources.fleet,
}));

vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergySites: () => ({ data: [], isSuccess: true }),
  useTeslaEnergySiteInfo: () => ({}),
  useTeslaEnergyLiveStatus: () => ({}),
  useTeslaEnergyHistory: () => ({}),
}));

function vehicle(id: number): Vehicle {
  return {
    id, vehicle_id: id, vin: `fixture-${id}`, display_name: `Vehicle ${id}`,
    model: '', trim_badging: '', exterior_color: '', wheel_type: '',
    state: 'online', healthy: true, created_at: '', updated_at: '',
  };
}

function entry(id: number, overrides: Partial<FleetStateEntry> = {}): FleetStateEntry {
  return {
    vehicle: vehicle(id),
    state: {
      vehicle_id: id, state: 'online', battery_level: 0,
      latitude: null, longitude: null, speed: null, power: null,
      rated_range: null, ideal_range: null, odometer: null,
      inside_temp: null, outside_temp: null, is_climate_on: null, is_charging: null,
      charger_power: null, charge_rate: null, time_to_full_charge: null,
      is_locked: null, sentry_mode: null, software_version: null,
    },
    outcome: 'resolved', freshness: 'fresh', verifiedFields: ['state', 'battery_level'],
    stale: false, observedAt: 1000, receivedAt: 2000, ...overrides,
  };
}

function setFleet(data: FleetStateEntry[] | undefined, overrides: DataStateSource<FleetStateEntry[]> = {}) {
  sources.fleet = {
    data, isSuccess: data !== undefined, isError: false, isFetching: false,
    fetchStatus: 'idle', dataUpdatedAt: 9000, refetch: sources.refetch, ...overrides,
  };
}

function stateOf(value: ReturnType<typeof useHomeEnergyOrchestration>, id = 'fleet') {
  const source = value.sourceStates.find((source) => source.id === id);
  expect(source).toBeDefined();
  return source!.state;
}

describe('useHomeEnergyOrchestration fleet source trust', () => {
  beforeEach(() => {
    localStorage.clear();
    sources.refetch.mockClear();
    sources.vehicles = { data: [vehicle(1)], isSuccess: true };
    setFleet(undefined);
  });

  describe('useHomeEnergyOrchestration SOC observations', () => {
    const now = 600_000;

    beforeEach(() => {
      vi.spyOn(Date, 'now').mockReturnValue(now);
      localStorage.clear();
      setFleet(undefined);
    });

    afterEach(() => vi.restoreAllMocks());

    it('distinguishes observed 50%, zero, list aliases and defaults without changing optimizer inputs', () => {
      sources.vehicles = {
        data: [
          { ...vehicle(1), battery_level: 80 },
          { ...vehicle(2), battery_level: 50, updated_at: new Date(now).toISOString() },
          { ...vehicle(3), batteryLevel: 0 }, vehicle(4), vehicle(5),
        ],
        isSuccess: true,
      };
      const observed = entry(1);
      setFleet([
        { ...observed, state: { ...observed.state!, battery_level: 50 }, observedAt: now - 120_000 },
        entry(5, { observedAt: now - 10_000 }),
      ]);
      const { result } = renderHook(() => useHomeEnergyOrchestration());
      expect(result.current.vehicleSocObservations).toEqual([
        { vehicleId: '1', currentSocPct: 50, origin: 'fleet-state', observedAt: now - 120_000, ageMs: 120_000 },
        { vehicleId: '2', currentSocPct: 50, origin: 'vehicle-battery', observedAt: null, ageMs: null },
        { vehicleId: '3', currentSocPct: 0, origin: 'vehicle-battery', observedAt: null, ageMs: null },
        { vehicleId: '4', currentSocPct: 50, origin: 'default', observedAt: null, ageMs: null },
        { vehicleId: '5', currentSocPct: 0, origin: 'fleet-state', observedAt: now - 10_000, ageMs: 10_000 },
      ]);
      expect(result.current.input.vehicles.map((v) => v.currentSocPct)).toEqual([50, 50, 0, 50, 0]);
      expect(result.current.input.vehicles[0]).not.toHaveProperty('origin');
      expect(result.current.result).toEqual(optimizeHomeEnergy(result.current.input));
    });

    it('keeps retained observation age growing independently of wrapper refresh time', () => {
      sources.vehicles = { data: [vehicle(1)], isSuccess: true };
      setFleet([entry(1, {
        observedAt: now - 300_000, outcome: 'failed', stale: true,
        error: new Error('Refresh failed'),
      })]);
      const { result, rerender } = renderHook(() => useHomeEnergyOrchestration());
      expect(result.current.vehicleSocObservations[0].ageMs).toBe(300_000);
      vi.mocked(Date.now).mockReturnValue(now + 60_000);
      sources.fleet = { ...sources.fleet, dataUpdatedAt: now + 60_000 };
      rerender();
      expect(result.current.vehicleSocObservations[0]).toMatchObject({
        origin: 'fleet-state', currentSocPct: 0, observedAt: now - 300_000, ageMs: 360_000,
      });
      expect(result.current.input.vehicles[0].currentSocPct).toBe(0);
    });

    it('keeps unknown observation times unknown and falls back from nonfinite SOC', () => {
      sources.vehicles = {
        data: [vehicle(1), vehicle(2), { ...vehicle(3), battery_level: 71 },
          { ...vehicle(4), battery_level: NaN }],
        isSuccess: true,
      };
      const invalid = entry(3);
      setFleet([
        entry(1, { observedAt: null }), entry(2, { observedAt: NaN }),
        { ...invalid, state: { ...invalid.state!, battery_level: Infinity } },
      ]);
      const { result } = renderHook(() => useHomeEnergyOrchestration());
      expect(result.current.vehicleSocObservations.map((v) => [v.currentSocPct, v.origin, v.ageMs])).toEqual([
        [0, 'fleet-state', null], [0, 'fleet-state', null],
        [71, 'vehicle-battery', null], [50, 'default', null],
      ]);
    });
  });

  it('keeps active first loading unknown rather than treating an empty summary as complete', () => {
    setFleet(undefined, { isPending: true, isLoading: true, isFetching: true, fetchStatus: 'fetching' });
    const { result } = renderHook(() => useHomeEnergyOrchestration());
    expect(stateOf(result.current)).toMatchObject({ status: 'initial', hasData: false, provenance: 'unknown' });
    expect(stateOf(result.current, 'fleet:1')).toMatchObject({ status: 'initial', hasData: false });
    expect(result.current.queries.at(-1)?.isFetching).toBe(true);
  });

  it('propagates paused-without-data without inventing a failure', () => {
    setFleet(undefined, { isPending: true, fetchStatus: 'paused' });
    const { result } = renderHook(() => useHomeEnergyOrchestration());
    for (const id of ['fleet', 'fleet:1']) {
      expect(stateOf(result.current, id)).toMatchObject({
        status: 'initial', hasData: false, isRefreshBlocked: true, fatalError: null, refreshError: null,
      });
    }
  });

  it('accepts a successfully empty fleet and a verified zero battery reading', () => {
    sources.vehicles = { data: [], isSuccess: true };
    setFleet([]);
    const { result, rerender } = renderHook(() => useHomeEnergyOrchestration());
    expect(stateOf(result.current)).toMatchObject({ status: 'ok', data: [], hasData: true });
    sources.vehicles = { data: [vehicle(1)], isSuccess: true };
    const zero = entry(1);
    setFleet([zero]);
    rerender();
    expect(stateOf(result.current, 'fleet:1')).toMatchObject({ status: 'ok', data: zero.state, updatedAt: 1000 });
    expect(stateOf(result.current)).toMatchObject({ status: 'ok', updatedAt: 1000 });
    expect(result.current.input.vehicles[0]?.currentSocPct).toBe(0);
  });

  it('propagates missing members and does not claim completeness when no request failed', () => {
    sources.vehicles = { data: [vehicle(1), vehicle(2)], isSuccess: true };
    setFleet([entry(1), entry(2, { outcome: 'missing', state: null, observedAt: null })]);
    const { result, rerender } = renderHook(() => useHomeEnergyOrchestration());
    expect(stateOf(result.current, 'fleet:2')).toMatchObject({ status: 'unavailable', data: null });
    expect(stateOf(result.current)).toMatchObject({ status: 'partial' });
    expect(result.current.queries.at(-1)).toMatchObject({ isError: false, isStale: true });
    setFleet([entry(1, { outcome: 'missing', state: null, observedAt: null }),
      entry(2, { outcome: 'missing', state: null, observedAt: null })]);
    rerender();
    expect(stateOf(result.current)).toMatchObject({ status: 'unavailable', updatedAt: null });
  });

  it.each(['fresh', 'stale', 'unknown'] as const)('retains %s unverified payloads as partial', (freshness) => {
    const unverified = entry(1, { freshness, stale: true, verifiedFields: [] });
    setFleet([unverified]);
    const { result } = renderHook(() => useHomeEnergyOrchestration());
    expect(stateOf(result.current, 'fleet:1')).toMatchObject({
      status: 'partial', provenance: 'cached', data: unverified.state,
    });
    expect(stateOf(result.current)).toMatchObject({ status: 'partial' });
    expect(result.current.input.vehicles[0]?.currentSocPct).toBe(0);
  });

  it('propagates failed members without discarding their healthy neighbors', () => {
    sources.vehicles = { data: [vehicle(1), vehicle(2)], isSuccess: true };
    const error = new Error('Member unavailable');
    setFleet([entry(1), entry(2, { outcome: 'failed', state: null, observedAt: null, error })]);
    const { result, rerender } = renderHook(() => useHomeEnergyOrchestration());
    expect(stateOf(result.current, 'fleet:2')).toMatchObject({ status: 'initialFailure', fatalError: error });
    expect(stateOf(result.current)).toMatchObject({ status: 'partial', hasData: true, fatalError: null });
    setFleet([entry(1, { outcome: 'failed', state: null, observedAt: null, error }),
      entry(2, { outcome: 'failed', state: null, observedAt: null, error })]);
    rerender();
    expect(stateOf(result.current)).toMatchObject({ status: 'initialFailure', hasData: false, fatalError: error });
  });

  it('does not treat an explicitly stale resolved member as complete despite fresh metadata', () => {
    const stale = entry(1, { stale: true });
    setFleet([stale]);
    const { result } = renderHook(() => useHomeEnergyOrchestration());
    for (const id of ['fleet', 'fleet:1']) {
      expect(stateOf(result.current, id)).toMatchObject({
        status: 'partial', provenance: 'cached', hasData: true,
      });
    }
    expect(stateOf(result.current, 'fleet:1').data).toBe(stale.state);
    expect(result.current.queries.at(-1)).toMatchObject({ isError: false, isStale: true });
  });

  it('retains readings and their observation time through refresh failure, then recovers', () => {
    const retained = entry(1);
    setFleet([retained]);
    const { result, rerender } = renderHook(() => useHomeEnergyOrchestration());
    setFleet([retained], { isFetching: true, fetchStatus: 'fetching' });
    rerender();
    expect(stateOf(result.current)).toMatchObject({ status: 'ok', isRefreshing: true, updatedAt: 1000 });
    setFleet([retained], { fetchStatus: 'paused' });
    rerender();
    expect(stateOf(result.current)).toMatchObject({
      status: 'stale', isRefreshBlocked: true, refreshError: null, updatedAt: 1000,
    });
    const error = new Error('Refresh failed');
    setFleet([{ ...retained, outcome: 'failed', stale: true, error, receivedAt: 9000 }]);
    rerender();
    for (const id of ['fleet', 'fleet:1']) {
      expect(stateOf(result.current, id)).toMatchObject({
        status: 'stale', hasData: true, provenance: 'cached',
        refreshError: error, fatalError: null, updatedAt: 1000,
      });
    }
    expect(stateOf(result.current, 'fleet:1').data).toBe(retained.state);
    expect(result.current.input.vehicles[0]?.currentSocPct).toBe(0);
    stateOf(result.current, 'fleet:1').retry?.();
    expect(sources.refetch).toHaveBeenCalledOnce();
    setFleet([entry(1, { observedAt: 10000 })]);
    rerender();
    expect(stateOf(result.current)).toMatchObject({
      status: 'ok', provenance: 'live', refreshError: null, updatedAt: 10000,
    });
    expect(result.current.queries.at(-1)).toMatchObject({ isError: false, isStale: false, dataUpdatedAt: 10000 });
  });
});
