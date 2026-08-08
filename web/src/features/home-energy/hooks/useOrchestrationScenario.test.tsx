import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'teslasync:home-energy-orchestrator:scenario:v1';

async function loadFreshModule() {
  vi.resetModules();
  return import('./useOrchestrationScenario');
}

describe('useOrchestrationScenario', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns documented defaults with no stored data', async () => {
    const mod = await loadFreshModule();
    const { result } = renderHook(() => mod.useOrchestrationScenario());
    expect(result.current.slotMinutes).toBe(15);
    expect(result.current.horizonHours).toBe(24);
    expect(result.current.powerwall.enabled).toBe(false);
    expect(result.current.vehicleAssumptions).toEqual({});
  });

  it('persists updateScenario patches and reflects them on next read', async () => {
    const mod = await loadFreshModule();
    const { result, rerender } = renderHook(() => mod.useOrchestrationScenario());

    act(() => {
      mod.updateScenario({ grid: { maxImportW: 9000, maxExportW: 3000 } });
    });
    rerender();

    expect(result.current.grid.maxImportW).toBe(9000);
    expect(result.current.grid.maxExportW).toBe(3000);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).grid.maxImportW).toBe(9000);
  });

  it('creates a per-vehicle assumption from defaults and merges partial patches', async () => {
    const mod = await loadFreshModule();
    const { result, rerender } = renderHook(() => mod.useOrchestrationScenario());

    act(() => {
      mod.updateVehicleAssumption('42', { targetSocPct: 90 });
    });
    rerender();

    expect(result.current.vehicleAssumptions['42'].targetSocPct).toBe(90);
    // Untouched fields still carry the documented default.
    expect(result.current.vehicleAssumptions['42'].priority).toBe('medium');

    act(() => {
      mod.updateVehicleAssumption('42', { priority: 'high' });
    });
    rerender();
    expect(result.current.vehicleAssumptions['42'].targetSocPct).toBe(90);
    expect(result.current.vehicleAssumptions['42'].priority).toBe('high');
  });

  it('sanitizes malformed persisted JSON instead of throwing', async () => {
    localStorage.setItem(STORAGE_KEY, '{ not valid json');
    const mod = await loadFreshModule();
    const { result } = renderHook(() => mod.useOrchestrationScenario());
    expect(result.current.slotMinutes).toBe(15);
  });

  it('clamps out-of-range values written directly to storage', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ powerwall: { reservePct: 500, capacityWh: -10 } }),
    );
    const mod = await loadFreshModule();
    const { result } = renderHook(() => mod.useOrchestrationScenario());
    expect(result.current.powerwall.reservePct).toBe(100);
    expect(result.current.powerwall.capacityWh).toBeGreaterThan(0);
  });

  it('commitPreviousPlan stores per-vehicle slot arrays and resetScenario restores defaults', async () => {
    const mod = await loadFreshModule();
    const { result, rerender } = renderHook(() => mod.useOrchestrationScenario());

    act(() => {
      mod.commitPreviousPlan({ '1': [4, 5, 6] });
    });
    rerender();
    expect(result.current.previousPlan['1']).toEqual([4, 5, 6]);

    act(() => {
      mod.resetScenario();
    });
    rerender();
    expect(result.current.previousPlan).toEqual({});
  });
});
