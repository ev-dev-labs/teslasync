/**
 * Whole-Home Energy Orchestrator — deterministic local optimizer.
 *
 * Coordinates N vehicles, solar, a home battery (Powerwall-class), import/
 * export tariffs, and site import/export caps across a 15-minute-slot
 * horizon. This is a constructive (greedy, merit-order) heuristic, not a
 * global LP/MILP solver — see the algorithm notes below — but it is fully
 * deterministic (same input always produces the same output), never issues
 * any command, and never fabricates readiness: infeasible deadlines and
 * capped/curtailed energy are reported as `Violation`s with the exact unmet
 * energy, not silently hidden.
 *
 * ── Algorithm ──────────────────────────────────────────────────────────
 * 1. Normalize input defensively (clamp/drop malformed entries, resize
 *    forecast/tariff arrays to the horizon) — this function never throws.
 * 2. For each vehicle, precompute a static "opportunistic slot set": the N
 *    cheapest candidate slots (tariff price discounted by forecast solar
 *    surplus, with a small bonus for slots that were charging in
 *    `previousPlan` — the schedule-stability term) it would need to meet
 *    its target at max power, ignoring contention with other vehicles.
 *    This is what drives tariff-shifting and solar-following behaviour.
 * 3. Walk the horizon chronologically once. In each slot:
 *      a. Serve household load from solar first, then battery discharge
 *         (down to the reserve floor), then grid import (capped).
 *      b. Determine which vehicles are *critical* this slot — i.e. they
 *         have zero slack left before their deadline and MUST charge now
 *         at max power to have any chance of being ready — vs. merely
 *         *opportunistic* (in their precomputed cheap-slot set).
 *      c. Allocate remaining solar, then grid import headroom, then (for
 *         critical vehicles only, as a last resort) battery discharge, in
 *         priority order (critical > priority > least slack > vehicle id).
 *      d. Any solar left over charges the battery, then exports (capped),
 *         then is curtailed (reported, never silently dropped).
 *      e. Battery SoC is updated causally from this slot's own charge/
 *         discharge — the model never charges and discharges in the same
 *         slot (see the structural proof in the code comment below).
 * 4. Summarize: per-vehicle delivered/unmet energy, 0–100 component scores,
 *    a weighted overall score, and a `Violation[]` list.
 *
 * Energy conservation holds exactly, every slot:
 *   solarW + gridImportW + batteryDischargeW
 *     == (loadW - unmetLoadW) + vehicleChargeW + batteryChargeW + gridExportW + curtailedW
 */

import type {
  GridLimits,
  ObjectiveWeights,
  OrchestrationInput,
  OrchestrationResult,
  OrchestrationTotals,
  PowerwallInput,
  Priority,
  Scores,
  SlotResult,
  TariffSlot,
  VehicleInput,
  VehiclePlanResult,
  Violation,
} from './types';

export const DEFAULT_WEIGHTS: ObjectiveWeights = {
  readiness: 0.3,
  cost: 0.2,
  selfConsumption: 0.15,
  peakShaving: 0.15,
  reserve: 0.15,
  stability: 0.05,
};

const PRIORITY_WEIGHT: Record<Priority, number> = { low: 1, medium: 2, high: 3 };

/** Floating-point tolerance for "is this energy/power effectively zero". */
const EPS = 1e-6;

/** Small $/kWh-equivalent nudge that prefers previously-selected slots (schedule stability). */
const STABILITY_DISCOUNT = 0.01;

const MAX_HORIZON_SLOTS = 500;
const DEFAULT_SLOT_MINUTES = 15;
const DEFAULT_EFFICIENCY = 0.9;

function clamp(n: unknown, lo: number, hi: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : lo;
  return Math.min(hi, Math.max(lo, v));
}

function finiteOr(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** Ceiling division that tolerates an infinite or non-positive divisor. */
function ceilDivSlots(energyWh: number, energyPerSlotWh: number): number {
  if (energyWh <= 0) return 0;
  if (!Number.isFinite(energyPerSlotWh) || energyPerSlotWh <= 0) return Infinity;
  return Math.ceil(energyWh / energyPerSlotWh - 1e-9);
}

function resizeNumberArray(arr: number[] | undefined, len: number, fallback: number): number[] {
  const out: number[] = new Array(len);
  const src = Array.isArray(arr) ? arr : [];
  let lastValid = fallback;
  for (let i = 0; i < len; i++) {
    const v = src[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      lastValid = Math.max(0, v);
      out[i] = lastValid;
    } else if (src.length > 0) {
      // Missing/invalid sample within a partially-provided series: hold the
      // last known-good value rather than snapping to the fallback.
      out[i] = lastValid;
    } else {
      out[i] = fallback;
    }
  }
  return out;
}

function resizeTariff(arr: TariffSlot[] | undefined, len: number): TariffSlot[] {
  const out: TariffSlot[] = new Array(len);
  const src = Array.isArray(arr) ? arr : [];
  const last = src[src.length - 1];
  for (let i = 0; i < len; i++) {
    const t = src[i] ?? last;
    out[i] = {
      importPricePerKwh: Math.max(0, finiteOr(t?.importPricePerKwh, 0)),
      exportPricePerKwh: Math.max(0, finiteOr(t?.exportPricePerKwh, 0)),
    };
  }
  return out;
}

interface WorkingVehicle {
  id: string;
  name: string;
  priority: Priority;
  currentSocPct: number;
  targetSocPct: number;
  usableCapacityWh: number;
  maxChargePowerW: number;
  maxEnergyPerSlotWh: number;
  departureSlot: number | null;
  neededWh: number;
  remainingWh: number;
  slotsSchedule: Array<{ slotIndex: number; powerW: number }>;
}

interface WorkingPowerwall {
  capacityWh: number;
  socPct: number;
  reservePct: number;
  maxChargePowerW: number;
  maxDischargePowerW: number;
  efficiency: number;
}

interface Normalized {
  slotMinutes: number;
  horizonSlots: number;
  startTimeIso: string;
  solar: number[];
  load: number[];
  tariff: TariffSlot[];
  vehicles: WorkingVehicle[];
  powerwall: WorkingPowerwall | null;
  grid: GridLimits;
  weights: ObjectiveWeights;
  previousPlan: Record<string, Set<number>>;
  warnings: Violation[];
  droppedVehicleCount: number;
}

function normalizeWeights(overrides: Partial<ObjectiveWeights> | undefined): ObjectiveWeights {
  const merged: ObjectiveWeights = { ...DEFAULT_WEIGHTS, ...(overrides ?? {}) };
  const clamped: ObjectiveWeights = {
    readiness: Math.max(0, finiteOr(merged.readiness, 0)),
    cost: Math.max(0, finiteOr(merged.cost, 0)),
    selfConsumption: Math.max(0, finiteOr(merged.selfConsumption, 0)),
    peakShaving: Math.max(0, finiteOr(merged.peakShaving, 0)),
    reserve: Math.max(0, finiteOr(merged.reserve, 0)),
    stability: Math.max(0, finiteOr(merged.stability, 0)),
  };
  const sum = Object.values(clamped).reduce((a, b) => a + b, 0);
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  return clamped;
}

function normalizeInput(input: OrchestrationInput | null | undefined): Normalized {
  const warnings: Violation[] = [];
  const safeInput = input && typeof input === 'object' ? input : ({} as Partial<OrchestrationInput>);

  const slotMinutesRaw = finiteOr(safeInput.slotMinutes, DEFAULT_SLOT_MINUTES);
  const slotMinutes = slotMinutesRaw > 0 ? slotMinutesRaw : DEFAULT_SLOT_MINUTES;
  if (slotMinutesRaw <= 0) {
    warnings.push({ code: 'invalid_input', severity: 'warning', detail: 'slotMinutes must be positive; defaulted to 15' });
  }

  const horizonRaw = finiteOr(safeInput.horizonSlots, 0);
  const horizonSlots = horizonRaw > 0 ? Math.min(MAX_HORIZON_SLOTS, Math.floor(horizonRaw)) : 0;
  if (horizonRaw <= 0) {
    warnings.push({ code: 'invalid_input', severity: 'error', detail: 'horizonSlots must be a positive integer' });
  }

  const startTimeIso = typeof safeInput.startTimeIso === 'string' && !Number.isNaN(Date.parse(safeInput.startTimeIso))
    ? safeInput.startTimeIso
    : new Date(0).toISOString();

  const solar = resizeNumberArray(safeInput.solarForecastW, horizonSlots, 0);
  const load = resizeNumberArray(safeInput.loadForecastW, horizonSlots, 0);
  const tariff = resizeTariff(safeInput.tariff, horizonSlots);

  const slotHours = slotMinutes / 60;
  const vehicles: WorkingVehicle[] = [];
  let droppedVehicleCount = 0;
  const rawVehicles = Array.isArray(safeInput.vehicles) ? safeInput.vehicles : [];
  for (const v of rawVehicles as VehicleInput[]) {
    if (!v || typeof v.id !== 'string' || v.id.length === 0) {
      droppedVehicleCount += 1;
      warnings.push({ code: 'invalid_input', severity: 'warning', detail: 'vehicle entry missing a valid id — dropped' });
      continue;
    }
    const usableCapacityWh = finiteOr(v.usableCapacityWh, NaN);
    if (!(usableCapacityWh > 0)) {
      droppedVehicleCount += 1;
      warnings.push({ code: 'invalid_input', severity: 'warning', vehicleId: v.id, detail: 'usableCapacityWh must be > 0 — vehicle dropped' });
      continue;
    }
    const maxChargePowerW = Math.max(0, finiteOr(v.maxChargePowerW, 0));
    const currentSocPct = clamp(v.currentSocPct, 0, 100);
    const targetSocPct = clamp(v.targetSocPct, 0, 100);
    const neededWh = (Math.max(0, targetSocPct - currentSocPct) / 100) * usableCapacityWh;

    let departureSlot: number | null = null;
    if (v.departureSlot != null && Number.isFinite(v.departureSlot)) {
      const d = Math.round(v.departureSlot);
      if (d <= 0) departureSlot = 0;
      else if (d <= horizonSlots) departureSlot = d;
      else departureSlot = null; // deadline lies beyond the visible horizon — treat as opportunistic here
    }

    const priority: Priority = v.priority === 'low' || v.priority === 'high' ? v.priority : 'medium';

    vehicles.push({
      id: v.id,
      name: typeof v.name === 'string' && v.name.trim() ? v.name : v.id,
      priority,
      currentSocPct,
      targetSocPct,
      usableCapacityWh,
      maxChargePowerW,
      maxEnergyPerSlotWh: maxChargePowerW * slotHours,
      departureSlot,
      neededWh,
      remainingWh: neededWh,
      slotsSchedule: [],
    });
  }

  let powerwall: WorkingPowerwall | null = null;
  const pw = safeInput.powerwall as PowerwallInput | null | undefined;
  if (pw && typeof pw === 'object') {
    const capacityWh = finiteOr(pw.capacityWh, NaN);
    if (capacityWh > 0) {
      const effRaw = finiteOr(pw.roundTripEfficiency, DEFAULT_EFFICIENCY);
      powerwall = {
        capacityWh,
        socPct: clamp(pw.currentSocPct, 0, 100),
        reservePct: clamp(pw.reservePct, 0, 100),
        maxChargePowerW: Math.max(0, finiteOr(pw.maxChargePowerW, 0)),
        maxDischargePowerW: Math.max(0, finiteOr(pw.maxDischargePowerW, 0)),
        efficiency: effRaw > 0 && effRaw <= 1 ? effRaw : DEFAULT_EFFICIENCY,
      };
      if (powerwall.socPct < powerwall.reservePct) {
        warnings.push({
          code: 'powerwall_reserve_breach',
          severity: 'warning',
          slotIndex: 0,
          detail: 'starting Powerwall SoC is already below the configured reserve',
        });
      }
    } else {
      warnings.push({ code: 'invalid_input', severity: 'warning', detail: 'powerwall.capacityWh must be > 0 — battery ignored' });
    }
  }

  const maxImportW = finiteOr(safeInput.grid?.maxImportW, Infinity);
  const maxExportW = finiteOr(safeInput.grid?.maxExportW, Infinity);
  const grid: GridLimits = {
    maxImportW: maxImportW >= 0 ? maxImportW : Infinity,
    maxExportW: maxExportW >= 0 ? maxExportW : Infinity,
  };

  const previousPlan: Record<string, Set<number>> = {};
  if (safeInput.previousPlan && typeof safeInput.previousPlan === 'object') {
    for (const [id, slotsArr] of Object.entries(safeInput.previousPlan)) {
      if (Array.isArray(slotsArr)) previousPlan[id] = new Set(slotsArr.filter((n) => Number.isFinite(n)));
    }
  }

  return {
    slotMinutes,
    horizonSlots,
    startTimeIso,
    solar,
    load,
    tariff,
    vehicles,
    powerwall,
    grid,
    weights: normalizeWeights(safeInput.weights),
    previousPlan,
    warnings,
    droppedVehicleCount,
  };
}

/**
 * Precompute the set of slots (before this vehicle's deadline, or across the
 * whole horizon when it has none) in which the vehicle *should* charge when
 * it is not otherwise critical — the cheapest slots by tariff price,
 * discounted by forecast solar surplus, with a small bonus toward slots it
 * was already using in `previousPlan` (schedule stability). This is a static
 * approximation computed once from the forecasts (not the evolving ledger);
 * true physical contention between vehicles is resolved later, causally, in
 * the forward pass.
 */
function computeOpportunisticSlots(
  vehicle: WorkingVehicle,
  tariff: TariffSlot[],
  solarSurplus: number[],
  horizonSlots: number,
  previousSlots: Set<number> | undefined,
): Set<number> {
  if (vehicle.neededWh <= EPS || vehicle.maxEnergyPerSlotWh <= 0) return new Set();
  const upper = vehicle.departureSlot != null ? Math.min(vehicle.departureSlot, horizonSlots) : horizonSlots;
  if (upper <= 0) return new Set();

  const slotsNeeded = Math.min(upper, ceilDivSlots(vehicle.neededWh, vehicle.maxEnergyPerSlotWh));
  if (!Number.isFinite(slotsNeeded) || slotsNeeded <= 0) return new Set();

  const scored: Array<{ t: number; key: number }> = [];
  for (let t = 0; t < upper; t++) {
    const surplus = Math.max(0, solarSurplus[t] ?? 0);
    const coverage = vehicle.maxChargePowerW > 0 ? clamp(surplus / vehicle.maxChargePowerW, 0, 1) : 0;
    const price = (tariff[t]?.importPricePerKwh ?? 0) * (1 - coverage);
    const bonus = previousSlots?.has(t) ? STABILITY_DISCOUNT : 0;
    scored.push({ t, key: price - bonus });
  }
  scored.sort((a, b) => (a.key - b.key) || (a.t - b.t));
  return new Set(scored.slice(0, slotsNeeded).map((s) => s.t));
}

interface RankedVehicle {
  v: WorkingVehicle;
  isCritical: boolean;
  slack: number;
  desiredPowerW: number;
}

function rankActiveVehicles(vehicles: WorkingVehicle[], t: number, slotHours: number, opportunistic: Map<string, Set<number>>): RankedVehicle[] {
  const ranked: RankedVehicle[] = [];
  for (const v of vehicles) {
    if (v.remainingWh <= EPS) continue;
    if (v.departureSlot != null && t >= v.departureSlot) continue;

    const remainingCandidateSlots = v.departureSlot != null ? Math.max(0, v.departureSlot - t) : Infinity;
    const slotsNeededNow = ceilDivSlots(v.remainingWh, v.maxEnergyPerSlotWh);
    const slack = v.departureSlot != null ? remainingCandidateSlots - slotsNeededNow : Infinity;
    const isCritical = v.departureSlot != null && slack <= 0;
    const isOpportunistic = opportunistic.get(v.id)?.has(t) ?? false;
    if (!isCritical && !isOpportunistic) continue;

    const desiredPowerW = Math.min(v.maxChargePowerW, v.remainingWh / slotHours);
    if (desiredPowerW <= EPS) continue;
    ranked.push({ v, isCritical, slack, desiredPowerW });
  }
  ranked.sort((a, b) => {
    if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
    const pa = PRIORITY_WEIGHT[a.v.priority];
    const pb = PRIORITY_WEIGHT[b.v.priority];
    if (pa !== pb) return pb - pa;
    if (a.slack !== b.slack) return a.slack - b.slack;
    return a.v.id < b.v.id ? -1 : a.v.id > b.v.id ? 1 : 0;
  });
  return ranked;
}

function runForwardPass(norm: Normalized): SlotResult[] {
  const { horizonSlots, solar, load, tariff, vehicles, powerwall, grid, slotMinutes } = norm;
  const slotHours = slotMinutes / 60;

  const solarSurplusStatic = solar.map((s, i) => s - (load[i] ?? 0));
  const opportunistic = new Map<string, Set<number>>();
  for (const v of vehicles) {
    opportunistic.set(v.id, computeOpportunisticSlots(v, tariff, solarSurplusStatic, horizonSlots, norm.previousPlan[v.id]));
  }

  let socPct = powerwall?.socPct ?? 0;
  const capacityWh = powerwall?.capacityWh ?? 0;
  const reservePct = powerwall?.reservePct ?? 0;
  const efficiency = powerwall?.efficiency ?? DEFAULT_EFFICIENCY;

  const startMs = Date.parse(norm.startTimeIso);
  const slots: SlotResult[] = [];

  for (let t = 0; t < horizonSlots; t++) {
    const solarW = Math.max(0, solar[t] ?? 0);
    const loadW = Math.max(0, load[t] ?? 0);

    let solarRemaining = solarW;
    const solarToLoad = Math.min(solarRemaining, loadW);
    solarRemaining -= solarToLoad;
    let loadRemaining = loadW - solarToLoad;

    const socWh = (socPct / 100) * capacityWh;
    const reserveWh = (reservePct / 100) * capacityWh;
    const dischargeAvailableWh = Math.max(0, socWh - reserveWh);
    const maxDischargeW = powerwall ? Math.min(powerwall.maxDischargePowerW, dischargeAvailableWh / slotHours) : 0;
    let dischargePool = maxDischargeW;

    const loadFromBattery = Math.min(loadRemaining, dischargePool);
    dischargePool -= loadFromBattery;
    loadRemaining -= loadFromBattery;

    const importForLoad = Math.min(loadRemaining, grid.maxImportW);
    const unmetLoadW = Math.max(0, loadRemaining - importForLoad);
    let importHeadroom = Math.max(0, grid.maxImportW - importForLoad);

    const ranked = rankActiveVehicles(vehicles, t, slotHours, opportunistic);

    const vehiclePowerW: Record<string, number> = {};
    for (const v of vehicles) vehiclePowerW[v.id] = 0;
    let vehicleFromGridW = 0;

    for (const r of ranked) {
      let cap = r.desiredPowerW;
      const fromSolar = Math.min(cap, solarRemaining);
      solarRemaining -= fromSolar;
      cap -= fromSolar;

      const fromGrid = Math.min(cap, importHeadroom);
      importHeadroom -= fromGrid;
      cap -= fromGrid;
      vehicleFromGridW += fromGrid;

      let fromBattery = 0;
      if (cap > EPS && r.isCritical) {
        fromBattery = Math.min(cap, dischargePool);
        dischargePool -= fromBattery;
        cap -= fromBattery;
      }

      const delivered = fromSolar + fromGrid + fromBattery;
      vehiclePowerW[r.v.id] = delivered;
      r.v.remainingWh = Math.max(0, r.v.remainingWh - delivered * slotHours);
      if (delivered > EPS) r.v.slotsSchedule.push({ slotIndex: t, powerW: delivered });
    }

    const vehicleChargeW = Object.values(vehiclePowerW).reduce((a, b) => a + b, 0);

    // Leftover solar (guaranteed 0 whenever any discharge happened this slot —
    // see the module doc comment's structural proof) charges the battery,
    // then exports (capped), then is curtailed.
    const chargeHeadroomWh = Math.max(0, capacityWh - socWh);
    const maxChargeW = powerwall ? Math.min(powerwall.maxChargePowerW, chargeHeadroomWh / (slotHours * efficiency)) : 0;
    const batteryChargeW = Math.min(solarRemaining, maxChargeW);
    solarRemaining -= batteryChargeW;

    const batteryDischargeW = maxDischargeW - dischargePool;

    const gridExportW = Math.min(solarRemaining, grid.maxExportW);
    const curtailedW = Math.max(0, solarRemaining - gridExportW);

    const netWhChange = batteryChargeW * slotHours * efficiency - batteryDischargeW * slotHours;
    if (capacityWh > 0) {
      const newSocWh = clamp(socWh + netWhChange, 0, capacityWh);
      socPct = clamp((newSocWh / capacityWh) * 100, 0, 100);
    } else {
      socPct = 0;
    }

    const gridImportW = importForLoad + vehicleFromGridW;
    const importPricePerKwh = tariff[t]?.importPricePerKwh ?? 0;
    const exportPricePerKwh = tariff[t]?.exportPricePerKwh ?? 0;
    const slotCost = (gridImportW * slotHours / 1000) * importPricePerKwh - (gridExportW * slotHours / 1000) * exportPricePerKwh;

    const startIso = Number.isFinite(startMs) ? new Date(startMs + t * slotMinutes * 60_000).toISOString() : norm.startTimeIso;

    slots.push({
      slotIndex: t,
      startIso,
      solarW,
      loadW,
      unmetLoadW,
      vehicleChargeW,
      vehiclePowerW,
      batteryChargeW,
      batteryDischargeW,
      batteryPowerW: batteryChargeW - batteryDischargeW,
      batterySocPct: socPct,
      gridImportW,
      gridExportW,
      curtailedW,
      importPricePerKwh,
      exportPricePerKwh,
      slotCost,
    });
  }

  return slots;
}

function buildVehicleResults(vehicles: WorkingVehicle[]): VehiclePlanResult[] {
  return vehicles.map((v) => {
    const deliveredWh = Math.max(0, v.neededWh - v.remainingWh);
    const unmetWh = Math.max(0, v.remainingWh);
    const finalSocPct = v.usableCapacityWh > 0
      ? clamp(v.currentSocPct + (deliveredWh / v.usableCapacityWh) * 100, 0, 100)
      : v.currentSocPct;
    return {
      vehicleId: v.id,
      name: v.name,
      priority: v.priority,
      startingSocPct: v.currentSocPct,
      targetSocPct: v.targetSocPct,
      finalSocPct,
      neededWh: v.neededWh,
      deliveredWh,
      unmetWh,
      readinessAchieved: unmetWh <= 1e-3,
      departureSlot: v.departureSlot,
      slots: v.slotsSchedule,
    };
  });
}

function collectViolations(norm: Normalized, slots: SlotResult[], vehicleResults: VehiclePlanResult[]): Violation[] {
  const violations: Violation[] = [...norm.warnings];

  for (const vr of vehicleResults) {
    if (vr.unmetWh > 1e-3) {
      violations.push({
        code: vr.departureSlot != null ? 'deadline_infeasible' : 'vehicle_shortfall',
        severity: vr.departureSlot != null ? 'error' : 'warning',
        vehicleId: vr.vehicleId,
        vehicleName: vr.name,
        slotIndex: vr.departureSlot ?? undefined,
        unmetWh: vr.unmetWh,
      });
    }
  }

  for (const s of slots) {
    if (s.unmetLoadW > EPS) {
      violations.push({ code: 'panel_import_exceeded', severity: 'error', slotIndex: s.slotIndex, detail: `${s.unmetLoadW.toFixed(0)} W of household load could not be imported` });
    }
    if (s.curtailedW > EPS) {
      violations.push({ code: 'panel_export_exceeded', severity: 'warning', slotIndex: s.slotIndex, detail: `${s.curtailedW.toFixed(0)} W of solar curtailed` });
    }
  }

  if (norm.powerwall) {
    for (const s of slots) {
      if (s.batterySocPct < norm.powerwall.reservePct - 1e-6) {
        violations.push({ code: 'powerwall_reserve_breach', severity: 'warning', slotIndex: s.slotIndex, detail: 'battery SoC below configured reserve' });
      }
    }
  }

  return violations;
}

function computeScores(
  norm: Normalized,
  slots: SlotResult[],
  vehicleResults: VehiclePlanResult[],
  hasPreviousPlan: boolean,
): Scores {
  const slotHours = norm.slotMinutes / 60;

  let readinessWeighted = 0;
  let readinessWeightSum = 0;
  for (const vr of vehicleResults) {
    const w = PRIORITY_WEIGHT[vr.priority];
    const pct = vr.neededWh <= EPS ? 100 : clamp((vr.deliveredWh / vr.neededWh) * 100, 0, 100);
    readinessWeighted += w * pct;
    readinessWeightSum += w;
  }
  const readiness = readinessWeightSum > 0 ? readinessWeighted / readinessWeightSum : 100;

  const actualCost = slots.reduce((s, x) => s + x.slotCost, 0);
  const naiveImportPrice = norm.tariff[0]?.importPricePerKwh ?? 0;
  const baselineCost = norm.vehicles.reduce((s, v) => s + (v.neededWh / 1000) * naiveImportPrice, 0);
  const cost = baselineCost > EPS ? clamp(100 * (1 - actualCost / baselineCost), 0, 100) : (actualCost <= EPS ? 100 : 0);

  const totalSolarWh = slots.reduce((s, x) => s + x.solarW * slotHours, 0);
  const exportedWh = slots.reduce((s, x) => s + x.gridExportW * slotHours, 0);
  const curtailedWh = slots.reduce((s, x) => s + x.curtailedW * slotHours, 0);
  const selfConsumedWh = Math.max(0, totalSolarWh - exportedWh - curtailedWh);
  const selfConsumption = totalSolarWh > EPS ? clamp((selfConsumedWh / totalSolarWh) * 100, 0, 100) : 100;

  const peakImportW = slots.reduce((m, x) => Math.max(m, x.gridImportW), 0);
  const peakShaving = Number.isFinite(norm.grid.maxImportW) && norm.grid.maxImportW > EPS
    ? clamp(100 * (1 - peakImportW / norm.grid.maxImportW), 0, 100)
    : 100;

  let reserve = 100;
  if (norm.powerwall) {
    const worstBreachPct = slots.reduce((m, x) => Math.max(m, norm.powerwall!.reservePct - x.batterySocPct), 0);
    reserve = worstBreachPct <= 0 ? 100 : clamp(100 - (worstBreachPct / Math.max(1, norm.powerwall.reservePct)) * 100, 0, 100);
  }

  let stability: number | null = null;
  if (hasPreviousPlan) {
    let matches = 0;
    let total = 0;
    for (const v of norm.vehicles) {
      const prev = norm.previousPlan[v.id];
      if (!prev) continue;
      const current = new Set(v.slotsSchedule.map((s) => s.slotIndex));
      const allSlots = new Set<number>([...prev, ...current]);
      for (const slotIdx of allSlots) {
        total += 1;
        if (prev.has(slotIdx) === current.has(slotIdx)) matches += 1;
      }
    }
    stability = total > 0 ? clamp((matches / total) * 100, 0, 100) : 100;
  }

  const parts: Array<[number, number]> = [
    [readiness, norm.weights.readiness],
    [cost, norm.weights.cost],
    [selfConsumption, norm.weights.selfConsumption],
    [peakShaving, norm.weights.peakShaving],
    [reserve, norm.weights.reserve],
  ];
  if (stability != null) parts.push([stability, norm.weights.stability]);
  const totalWeight = parts.reduce((s, [, w]) => s + w, 0);
  const overall = totalWeight > 0 ? parts.reduce((s, [val, w]) => s + val * w, 0) / totalWeight : 0;

  return { readiness, cost, selfConsumption, peakShaving, reserve, stability, overall };
}

function computeTotals(slots: SlotResult[], slotMinutes: number): OrchestrationTotals {
  const slotHours = slotMinutes / 60;
  const totals: OrchestrationTotals = {
    solarWh: 0,
    loadWh: 0,
    vehicleChargeWh: 0,
    gridImportWh: 0,
    gridExportWh: 0,
    curtailedWh: 0,
    totalCost: 0,
    peakGridImportW: 0,
  };
  for (const s of slots) {
    totals.solarWh += s.solarW * slotHours;
    totals.loadWh += s.loadW * slotHours;
    totals.vehicleChargeWh += s.vehicleChargeW * slotHours;
    totals.gridImportWh += s.gridImportW * slotHours;
    totals.gridExportWh += s.gridExportW * slotHours;
    totals.curtailedWh += s.curtailedW * slotHours;
    totals.totalCost += s.slotCost;
    totals.peakGridImportW = Math.max(totals.peakGridImportW, s.gridImportW);
  }
  return totals;
}

/**
 * Run the deterministic Whole-Home Energy Orchestrator.
 *
 * Pure function: never throws, never mutates `input`, never reads the
 * clock/RNG. Calling it twice with equivalent input always yields
 * deep-equal output.
 */
export function optimizeHomeEnergy(input: OrchestrationInput): OrchestrationResult {
  const norm = normalizeInput(input);

  if (norm.horizonSlots <= 0) {
    return {
      feasible: false,
      slots: [],
      vehicles: [],
      scores: { readiness: 100, cost: 100, selfConsumption: 100, peakShaving: 100, reserve: 100, stability: null, overall: 0 },
      violations: norm.warnings,
      totals: { solarWh: 0, loadWh: 0, vehicleChargeWh: 0, gridImportWh: 0, gridExportWh: 0, curtailedWh: 0, totalCost: 0, peakGridImportW: 0 },
      meta: {
        slotMinutes: norm.slotMinutes,
        horizonSlots: 0,
        startTimeIso: norm.startTimeIso,
        droppedVehicleCount: norm.droppedVehicleCount,
      },
    };
  }

  const slots = runForwardPass(norm);
  const vehicleResults = buildVehicleResults(norm.vehicles);
  const hasPreviousPlan = Object.keys(norm.previousPlan).length > 0;
  const scores = computeScores(norm, slots, vehicleResults, hasPreviousPlan);
  const violations = collectViolations(norm, slots, vehicleResults);
  const totals = computeTotals(slots, norm.slotMinutes);
  const feasible = !violations.some((v) => v.severity === 'error');

  return {
    feasible,
    slots,
    vehicles: vehicleResults,
    scores,
    violations,
    totals,
    meta: {
      slotMinutes: norm.slotMinutes,
      horizonSlots: norm.horizonSlots,
      startTimeIso: norm.startTimeIso,
      droppedVehicleCount: norm.droppedVehicleCount,
    },
  };
}
