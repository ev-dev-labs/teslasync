/**
 * Whole-Home Energy Orchestrator — pure domain types.
 *
 * Every numeric quantity here is SI-canonical: power in watts (W), energy in
 * watt-hours (Wh), state-of-charge in percent (0–100), currency-per-energy in
 * $/kWh (the one deliberate non-SI unit, kept because tariffs are universally
 * quoted per kWh). Convert to a user-facing unit ONLY at the display
 * boundary via `useUnits()` / `useFormatting()` — never inside this module.
 *
 * This module intentionally has zero React / DOM / fetch dependencies so the
 * optimizer stays a pure, synchronously-testable function of its input.
 */

/** Coarse charging priority used to arbitrate contention between vehicles. */
export type Priority = 'low' | 'medium' | 'high';

/** One vehicle's charging needs and constraints for the orchestration horizon. */
export interface VehicleInput {
  /** Stable identifier (string form of the TeslaSync vehicle id). */
  id: string;
  /** Display name shown in the UI. */
  name: string;
  /** Current state of charge, percent (0–100). */
  currentSocPct: number;
  /** Desired state of charge by the departure deadline, percent (0–100). */
  targetSocPct: number;
  /** Usable pack capacity, watt-hours. */
  usableCapacityWh: number;
  /** Maximum AC/DC charge power the vehicle+charger can sustain, watts. */
  maxChargePowerW: number;
  /**
   * Slot index (0-based, into the same horizon as the forecasts) at which
   * the vehicle must depart. `null` means no known deadline — charging is
   * purely opportunistic (cost/solar driven) with no hard readiness
   * constraint.
   */
  departureSlot: number | null;
  /** Arbitration weight when multiple vehicles contend for limited power. */
  priority: Priority;
}

/** Import/export tariff for one slot. Both are $/kWh, always >= 0. */
export interface TariffSlot {
  importPricePerKwh: number;
  exportPricePerKwh: number;
}

/** Home battery (Powerwall-class) system state and limits. */
export interface PowerwallInput {
  /** Total usable capacity, watt-hours. */
  capacityWh: number;
  /** Current state of charge, percent (0–100). */
  currentSocPct: number;
  /** Backup reserve floor the optimizer will not discharge below, percent. */
  reservePct: number;
  /** Maximum charge power, watts. */
  maxChargePowerW: number;
  /** Maximum discharge power, watts. */
  maxDischargePowerW: number;
  /**
   * Round-trip efficiency (0–1]. Applied on the charge side only (a
   * documented simplification — see `optimizer.ts`). Defaults to 0.9 when
   * omitted or out of range.
   */
  roundTripEfficiency?: number;
}

/** Site-level (panel/service/grid interconnect) import & export caps, watts. */
export interface GridLimits {
  maxImportW: number;
  maxExportW: number;
}

/** Relative weights (need not sum to 1 — normalized internally) for the overall score. */
export interface ObjectiveWeights {
  readiness: number;
  cost: number;
  selfConsumption: number;
  peakShaving: number;
  reserve: number;
  stability: number;
}

/** Full input to the deterministic optimizer. */
export interface OrchestrationInput {
  /** Slot duration in minutes. Canonical value is 15. */
  slotMinutes: number;
  /** Number of slots in the planning horizon. */
  horizonSlots: number;
  /** ISO-8601 instant slot 0 begins at. Used only to label output timestamps. */
  startTimeIso: string;
  vehicles: VehicleInput[];
  /** Forecast solar generation, watts, one entry per slot. */
  solarForecastW: number[];
  /** Forecast household base load (excludes vehicle charging), watts, one entry per slot. */
  loadForecastW: number[];
  /** Tariff, one entry per slot. */
  tariff: TariffSlot[];
  /** `null` when the site has no home battery. */
  powerwall: PowerwallInput | null;
  grid: GridLimits;
  /** Overrides merged over `DEFAULT_WEIGHTS`. */
  weights?: Partial<ObjectiveWeights>;
  /**
   * Previous plan's charging slots per vehicle id, used only to bias slot
   * selection toward continuity (schedule-stability objective) and to score
   * stability. Optional — omit on a first run.
   */
  previousPlan?: Record<string, number[]>;
}

/** Structured violation/diagnostic. `message*` fields are i18n-key + params, never pre-rendered prose. */
export type ViolationCode =
  | 'deadline_infeasible'
  | 'vehicle_shortfall'
  | 'panel_import_exceeded'
  | 'panel_export_exceeded'
  | 'powerwall_reserve_breach'
  | 'invalid_input';

export type ViolationSeverity = 'error' | 'warning';

export interface Violation {
  code: ViolationCode;
  severity: ViolationSeverity;
  /** Present when the violation concerns one specific vehicle. */
  vehicleId?: string;
  vehicleName?: string;
  /** Present when the violation concerns one specific slot. */
  slotIndex?: number;
  /** Unmet energy, watt-hours, when applicable. */
  unmetWh?: number;
  /** Free-form machine detail for developer diagnostics / JSON export only. */
  detail?: string;
}

/** Per-slot physical ledger. Every field is SI-canonical (W, Wh where noted). */
export interface SlotResult {
  slotIndex: number;
  startIso: string;
  solarW: number;
  loadW: number;
  /** Household load left unserved because the grid import cap was reached (should be ~0 in sane scenarios). */
  unmetLoadW: number;
  /** Sum of power delivered to all vehicles this slot. */
  vehicleChargeW: number;
  /** Per-vehicle delivered power this slot, watts. */
  vehiclePowerW: Record<string, number>;
  /** Powerwall charge power this slot (>= 0). */
  batteryChargeW: number;
  /** Powerwall discharge power this slot (>= 0). Mutually exclusive with batteryChargeW. */
  batteryDischargeW: number;
  /** Convenience signed view: +charge / -discharge. */
  batteryPowerW: number;
  /** Powerwall SoC percent AFTER this slot's activity. */
  batterySocPct: number;
  gridImportW: number;
  gridExportW: number;
  /** Solar that could not be used, stored, or exported (export-cap limited). */
  curtailedW: number;
  importPricePerKwh: number;
  exportPricePerKwh: number;
  /** Net $ cost for this slot (import cost minus export credit). */
  slotCost: number;
}

/** Per-vehicle outcome summary. */
export interface VehiclePlanResult {
  vehicleId: string;
  name: string;
  priority: Priority;
  startingSocPct: number;
  targetSocPct: number;
  finalSocPct: number;
  neededWh: number;
  deliveredWh: number;
  /** `max(0, neededWh - deliveredWh)`. Never fabricated as 0 when infeasible. */
  unmetWh: number;
  readinessAchieved: boolean;
  departureSlot: number | null;
  /** `{ slotIndex, powerW }` entries where powerW > 0 — the vehicle's own schedule. */
  slots: Array<{ slotIndex: number; powerW: number }>;
}

/** 0–100 component scores plus the weighted overall. `stability` is `null` without a `previousPlan`. */
export interface Scores {
  readiness: number;
  cost: number;
  selfConsumption: number;
  peakShaving: number;
  reserve: number;
  stability: number | null;
  overall: number;
}

export interface OrchestrationTotals {
  solarWh: number;
  loadWh: number;
  vehicleChargeWh: number;
  gridImportWh: number;
  gridExportWh: number;
  curtailedWh: number;
  totalCost: number;
  peakGridImportW: number;
}

export interface OrchestrationResult {
  /** `false` when any `error`-severity violation exists — never fabricated readiness. */
  feasible: boolean;
  slots: SlotResult[];
  vehicles: VehiclePlanResult[];
  scores: Scores;
  violations: Violation[];
  totals: OrchestrationTotals;
  meta: {
    slotMinutes: number;
    horizonSlots: number;
    startTimeIso: string;
    /** Number of vehicle entries dropped during input normalization. */
    droppedVehicleCount: number;
  };
}
