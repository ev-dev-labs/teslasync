/**
 * Whole-Home Energy Orchestrator — default scenario assumptions.
 *
 * There is no backend endpoint that returns a household's actual utility
 * tariff or panel/service import-export limits (only a write-only
 * `useUpdateTOUSettings` mutation exists for Tesla's own TOU schedule — see
 * `@/api/hooks/useEnergy`). These values are therefore explicitly modeled as
 * **user-editable scenario assumptions**, seeded with reasonable defaults,
 * never presented as measured fact. `useOrchestrationScenario` persists the
 * user's edits locally.
 *
 * Pure, side-effect-free helpers only — safe to unit test directly.
 */

import type { TariffSlot } from './types';

export const DEFAULT_SLOT_MINUTES = 15;
export const DEFAULT_HORIZON_HOURS = 24;
export const DEFAULT_HORIZON_SLOTS = Math.round((DEFAULT_HORIZON_HOURS * 60) / DEFAULT_SLOT_MINUTES);

/** A simple two-rate (peak / off-peak) tariff shape, editable in the UI. */
export interface TariffScenario {
  importPeakPerKwh: number;
  importOffPeakPerKwh: number;
  exportPerKwh: number;
  /** Peak window start hour, 0–23 (UTC — see module caveat). */
  peakStartHour: number;
  /** Peak window end hour, 0–23, exclusive. May be `<= peakStartHour` to model an overnight-wrapping window. */
  peakEndHour: number;
}

export const DEFAULT_TARIFF_SCENARIO: TariffScenario = {
  importPeakPerKwh: 0.42,
  importOffPeakPerKwh: 0.14,
  exportPerKwh: 0.08,
  peakStartHour: 16,
  peakEndHour: 21,
};

export interface GridScenario {
  maxImportW: number;
  maxExportW: number;
}

/** A common 200A/240V split-phase service, conservatively derated — an editable placeholder, not a measurement. */
export const DEFAULT_GRID_SCENARIO: GridScenario = {
  maxImportW: 11_500,
  maxExportW: 7_680,
};

export interface PowerwallScenario {
  enabled: boolean;
  capacityWh: number;
  reservePct: number;
  maxChargePowerW: number;
  maxDischargePowerW: number;
  roundTripEfficiency: number;
}

export const DEFAULT_POWERWALL_SCENARIO: PowerwallScenario = {
  enabled: false,
  capacityWh: 13_500,
  reservePct: 20,
  maxChargePowerW: 5_000,
  maxDischargePowerW: 5_000,
  roundTripEfficiency: 0.9,
};

export interface VehicleAssumption {
  targetSocPct: number;
  /** Usable pack capacity, watt-hours — no sanctioned endpoint returns this reliably, so it is user-editable. */
  usableCapacityWh: number;
  maxChargePowerW: number;
  /** Departure hour of day, 0–23 (UTC — see module caveat). */
  departureHour: number;
  /** Whether the deadline is enforced at all (`false` = purely opportunistic charging). */
  hasDeadline: boolean;
  priority: 'low' | 'medium' | 'high';
}

export const DEFAULT_VEHICLE_ASSUMPTION: VehicleAssumption = {
  targetSocPct: 80,
  usableCapacityWh: 75_000,
  maxChargePowerW: 7_400,
  departureHour: 7,
  hasDeadline: true,
  priority: 'medium',
};

function clampHour(h: number): number {
  const n = Number.isFinite(h) ? Math.round(h) : 0;
  return Math.min(23, Math.max(0, n));
}

function utcHourOfSlot(startTimeIso: string, slotMinutes: number, slotIndex: number): number {
  const startMs = Date.parse(startTimeIso);
  const baseMs = Number.isFinite(startMs) ? startMs : 0;
  const ms = baseMs + slotIndex * slotMinutes * 60_000;
  return new Date(ms).getUTCHours();
}

/**
 * Expands a two-rate tariff scenario into a per-slot `TariffSlot[]` for the
 * given horizon. Peak/off-peak is decided by UTC hour-of-day (documented
 * simplification — see the module doc comment).
 */
export function buildTariffSeries(
  scenario: TariffScenario,
  startTimeIso: string,
  slotMinutes: number,
  horizonSlots: number,
): TariffSlot[] {
  const n = horizonSlots > 0 ? Math.floor(horizonSlots) : 0;
  const sm = slotMinutes > 0 ? slotMinutes : DEFAULT_SLOT_MINUTES;
  const peakStart = clampHour(scenario.peakStartHour);
  const peakEnd = clampHour(scenario.peakEndHour);
  const wraps = peakStart >= peakEnd;
  const importPeak = Math.max(0, scenario.importPeakPerKwh);
  const importOffPeak = Math.max(0, scenario.importOffPeakPerKwh);
  const exportPrice = Math.max(0, scenario.exportPerKwh);

  const out: TariffSlot[] = new Array(n);
  for (let t = 0; t < n; t++) {
    const hour = utcHourOfSlot(startTimeIso, sm, t);
    const isPeak = wraps ? hour >= peakStart || hour < peakEnd : hour >= peakStart && hour < peakEnd;
    out[t] = {
      importPricePerKwh: isPeak ? importPeak : importOffPeak,
      exportPricePerKwh: exportPrice,
    };
  }
  return out;
}

/**
 * Resolves a "next occurrence of this hour-of-day" departure assumption into
 * a concrete slot index within the horizon, or `null` when it falls outside
 * the visible horizon (opportunistic-only charging for this run).
 */
export function defaultDepartureSlot(
  departureHour: number,
  startTimeIso: string,
  slotMinutes: number,
  horizonSlots: number,
): number | null {
  const sm = slotMinutes > 0 ? slotMinutes : DEFAULT_SLOT_MINUTES;
  const startMs = Date.parse(startTimeIso);
  if (!Number.isFinite(startMs)) return null;
  const hour = clampHour(departureHour);
  const start = new Date(startMs);
  const candidateMs = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), hour, 0, 0, 0);
  let deltaMs = candidateMs - startMs;
  if (deltaMs < 0) deltaMs += 24 * 3_600_000;
  const slot = Math.round(deltaMs / (sm * 60_000));
  return slot >= 0 && slot <= horizonSlots ? slot : null;
}
