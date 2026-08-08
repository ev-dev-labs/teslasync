/**
 * Whole-Home Energy Orchestrator — persisted, editable scenario assumptions.
 *
 * Tariff rates, panel import/export limits, Powerwall specs, and per-vehicle
 * target SoC / deadline / priority are NOT available from any real backend
 * endpoint (see `lib/scenarioDefaults.ts`), so this hook persists the user's
 * own edits to `localStorage` — mirroring the `useAchievementCelebrationPrefs`
 * store pattern: a module-level cache driven by `useSyncExternalStore`, with
 * cross-tab sync via the `storage` event. No network I/O, no side effects
 * beyond the local browser.
 */

import { useSyncExternalStore } from 'react';
import type { ObjectiveWeights } from '../lib/types';
import {
  DEFAULT_GRID_SCENARIO,
  DEFAULT_HORIZON_HOURS,
  DEFAULT_POWERWALL_SCENARIO,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TARIFF_SCENARIO,
  DEFAULT_VEHICLE_ASSUMPTION,
  type GridScenario,
  type PowerwallScenario,
  type TariffScenario,
  type VehicleAssumption,
} from '../lib/scenarioDefaults';

export interface OrchestrationScenario {
  slotMinutes: number;
  horizonHours: number;
  tariff: TariffScenario;
  grid: GridScenario;
  powerwall: PowerwallScenario;
  /** Keyed by vehicle id (string). Unknown vehicles fall back to `DEFAULT_VEHICLE_ASSUMPTION`. */
  vehicleAssumptions: Record<string, VehicleAssumption>;
  weights: Partial<ObjectiveWeights>;
  /** Keyed by vehicle id — last committed plan's charging slots, used for the schedule-stability score. */
  previousPlan: Record<string, number[]>;
}

const STORAGE_KEY = 'teslasync:home-energy-orchestrator:scenario:v1';

export const DEFAULT_SCENARIO: OrchestrationScenario = {
  slotMinutes: DEFAULT_SLOT_MINUTES,
  horizonHours: DEFAULT_HORIZON_HOURS,
  tariff: DEFAULT_TARIFF_SCENARIO,
  grid: DEFAULT_GRID_SCENARIO,
  powerwall: DEFAULT_POWERWALL_SCENARIO,
  vehicleAssumptions: {},
  weights: {},
  previousPlan: {},
};

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function sanitizeTariff(v: unknown): TariffScenario {
  const t = (v ?? {}) as Partial<TariffScenario>;
  return {
    importPeakPerKwh: isFiniteNumber(t.importPeakPerKwh) ? Math.max(0, t.importPeakPerKwh) : DEFAULT_TARIFF_SCENARIO.importPeakPerKwh,
    importOffPeakPerKwh: isFiniteNumber(t.importOffPeakPerKwh) ? Math.max(0, t.importOffPeakPerKwh) : DEFAULT_TARIFF_SCENARIO.importOffPeakPerKwh,
    exportPerKwh: isFiniteNumber(t.exportPerKwh) ? Math.max(0, t.exportPerKwh) : DEFAULT_TARIFF_SCENARIO.exportPerKwh,
    peakStartHour: isFiniteNumber(t.peakStartHour) ? t.peakStartHour : DEFAULT_TARIFF_SCENARIO.peakStartHour,
    peakEndHour: isFiniteNumber(t.peakEndHour) ? t.peakEndHour : DEFAULT_TARIFF_SCENARIO.peakEndHour,
  };
}

function sanitizeGrid(v: unknown): GridScenario {
  const g = (v ?? {}) as Partial<GridScenario>;
  return {
    maxImportW: isFiniteNumber(g.maxImportW) && g.maxImportW > 0 ? g.maxImportW : DEFAULT_GRID_SCENARIO.maxImportW,
    maxExportW: isFiniteNumber(g.maxExportW) && g.maxExportW >= 0 ? g.maxExportW : DEFAULT_GRID_SCENARIO.maxExportW,
  };
}

function sanitizePowerwall(v: unknown): PowerwallScenario {
  const p = (v ?? {}) as Partial<PowerwallScenario>;
  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_POWERWALL_SCENARIO.enabled,
    capacityWh: isFiniteNumber(p.capacityWh) && p.capacityWh > 0 ? p.capacityWh : DEFAULT_POWERWALL_SCENARIO.capacityWh,
    reservePct: isFiniteNumber(p.reservePct) ? Math.min(100, Math.max(0, p.reservePct)) : DEFAULT_POWERWALL_SCENARIO.reservePct,
    maxChargePowerW: isFiniteNumber(p.maxChargePowerW) && p.maxChargePowerW >= 0 ? p.maxChargePowerW : DEFAULT_POWERWALL_SCENARIO.maxChargePowerW,
    maxDischargePowerW: isFiniteNumber(p.maxDischargePowerW) && p.maxDischargePowerW >= 0 ? p.maxDischargePowerW : DEFAULT_POWERWALL_SCENARIO.maxDischargePowerW,
    roundTripEfficiency:
      isFiniteNumber(p.roundTripEfficiency) && p.roundTripEfficiency > 0 && p.roundTripEfficiency <= 1
        ? p.roundTripEfficiency
        : DEFAULT_POWERWALL_SCENARIO.roundTripEfficiency,
  };
}

function sanitizeVehicleAssumption(v: unknown): VehicleAssumption {
  const a = (v ?? {}) as Partial<VehicleAssumption>;
  const priority = a.priority === 'low' || a.priority === 'high' ? a.priority : DEFAULT_VEHICLE_ASSUMPTION.priority;
  return {
    targetSocPct: isFiniteNumber(a.targetSocPct) ? Math.min(100, Math.max(0, a.targetSocPct)) : DEFAULT_VEHICLE_ASSUMPTION.targetSocPct,
    usableCapacityWh: isFiniteNumber(a.usableCapacityWh) && a.usableCapacityWh > 0 ? a.usableCapacityWh : DEFAULT_VEHICLE_ASSUMPTION.usableCapacityWh,
    maxChargePowerW: isFiniteNumber(a.maxChargePowerW) && a.maxChargePowerW >= 0 ? a.maxChargePowerW : DEFAULT_VEHICLE_ASSUMPTION.maxChargePowerW,
    departureHour: isFiniteNumber(a.departureHour) ? Math.min(23, Math.max(0, Math.round(a.departureHour))) : DEFAULT_VEHICLE_ASSUMPTION.departureHour,
    hasDeadline: typeof a.hasDeadline === 'boolean' ? a.hasDeadline : DEFAULT_VEHICLE_ASSUMPTION.hasDeadline,
    priority,
  };
}

function sanitizeVehicleAssumptions(v: unknown): Record<string, VehicleAssumption> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, VehicleAssumption> = {};
  for (const [id, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof id === 'string' && id) out[id] = sanitizeVehicleAssumption(val);
  }
  return out;
}

function sanitizeWeights(v: unknown): Partial<ObjectiveWeights> {
  if (!v || typeof v !== 'object') return {};
  const src = v as Partial<Record<keyof ObjectiveWeights, unknown>>;
  const out: Partial<ObjectiveWeights> = {};
  (['readiness', 'cost', 'selfConsumption', 'peakShaving', 'reserve', 'stability'] as const).forEach((k) => {
    const n = src[k];
    if (isFiniteNumber(n) && n >= 0) out[k] = n;
  });
  return out;
}

function sanitizePreviousPlan(v: unknown): Record<string, number[]> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, number[]> = {};
  for (const [id, slots] of Object.entries(v as Record<string, unknown>)) {
    if (typeof id === 'string' && id && Array.isArray(slots)) {
      out[id] = slots.filter((n) => typeof n === 'number' && Number.isFinite(n));
    }
  }
  return out;
}

function sanitizeScenario(raw: unknown): OrchestrationScenario {
  const r = (raw ?? {}) as Partial<OrchestrationScenario>;
  return {
    slotMinutes: isFiniteNumber(r.slotMinutes) && r.slotMinutes > 0 ? r.slotMinutes : DEFAULT_SCENARIO.slotMinutes,
    horizonHours: isFiniteNumber(r.horizonHours) && r.horizonHours > 0 ? Math.min(72, r.horizonHours) : DEFAULT_SCENARIO.horizonHours,
    tariff: sanitizeTariff(r.tariff),
    grid: sanitizeGrid(r.grid),
    powerwall: sanitizePowerwall(r.powerwall),
    vehicleAssumptions: sanitizeVehicleAssumptions(r.vehicleAssumptions),
    weights: sanitizeWeights(r.weights),
    previousPlan: sanitizePreviousPlan(r.previousPlan),
  };
}

function readScenario(): OrchestrationScenario {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SCENARIO;
    return sanitizeScenario(JSON.parse(raw));
  } catch {
    return DEFAULT_SCENARIO;
  }
}

// Stable cache so useSyncExternalStore returns referentially-equal snapshots
// when nothing has changed (React 18 requires this to avoid tearing/loops).
let cached: OrchestrationScenario = readScenario();
let cachedSerialized = JSON.stringify(cached);

function getSnapshot(): OrchestrationScenario {
  return cached;
}

function refreshSnapshot(): void {
  const next = readScenario();
  const serialized = JSON.stringify(next);
  if (serialized !== cachedSerialized) {
    cached = next;
    cachedSerialized = serialized;
  }
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    refreshSnapshot();
    cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function persist(next: OrchestrationScenario): void {
  const serialized = JSON.stringify(next);
  if (serialized === cachedSerialized) return;
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Private mode / quota exceeded — keep the in-memory value for this tab.
  }
  cached = next;
  cachedSerialized = serialized;
  for (const cb of listeners) cb();
}

/** Patches top-level scenario fields (tariff, grid, powerwall, horizon, weights). Deep-merges one level. */
export function updateScenario(patch: Partial<OrchestrationScenario>): void {
  const next: OrchestrationScenario = {
    ...cached,
    ...patch,
    tariff: patch.tariff ? sanitizeTariff({ ...cached.tariff, ...patch.tariff }) : cached.tariff,
    grid: patch.grid ? sanitizeGrid({ ...cached.grid, ...patch.grid }) : cached.grid,
    powerwall: patch.powerwall ? sanitizePowerwall({ ...cached.powerwall, ...patch.powerwall }) : cached.powerwall,
    weights: patch.weights ? sanitizeWeights({ ...cached.weights, ...patch.weights }) : cached.weights,
  };
  persist(sanitizeScenario(next));
}

/** Patches one vehicle's assumption set (creating it from defaults if unset). */
export function updateVehicleAssumption(vehicleId: string, patch: Partial<VehicleAssumption>): void {
  if (!vehicleId) return;
  const current = cached.vehicleAssumptions[vehicleId] ?? DEFAULT_VEHICLE_ASSUMPTION;
  const merged = sanitizeVehicleAssumption({ ...current, ...patch });
  persist({
    ...cached,
    vehicleAssumptions: { ...cached.vehicleAssumptions, [vehicleId]: merged },
  });
}

/** Records the given plan's per-vehicle charging slots as the new "previous plan" baseline (schedule-stability anchor). */
export function commitPreviousPlan(plan: Record<string, number[]>): void {
  persist({ ...cached, previousPlan: sanitizePreviousPlan(plan) });
}

/** Restores every field to its documented default (does not affect other tabs' in-flight edits until they re-sync). */
export function resetScenario(): void {
  persist(DEFAULT_SCENARIO);
}

/**
 * Subscribes to the persisted Whole-Home Energy Orchestrator scenario.
 * Pairs with the imperative `updateScenario` / `updateVehicleAssumption` /
 * `commitPreviousPlan` / `resetScenario` setters — this hook itself only
 * reads.
 */
export function useOrchestrationScenario(): OrchestrationScenario {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_SCENARIO);
}
