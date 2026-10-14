/**
 * Evidence normalizers.
 *
 * Pure functions that convert raw hook/query data (already fetched by the
 * feature's `hooks/useVaultEvidence.ts` via existing TanStack Query hooks)
 * into the report's `VaultEvidence` shapes. Every function:
 *
 *   - Is total and null-safe: missing/undefined input yields `null` for
 *     that evidence section (never throws, never fabricates data).
 *   - Stores true SI-canonical units wherever the source hook provides
 *     them (watt-hours, seconds, meters — see field-level doc comments in
 *     `types.ts`), deferring km/mi/kWh-vs-Wh *display* formatting entirely
 *     to `useUnits()` in the UI layer.
 *   - Applies the selected date precision via `applyDatePrecision()` so no
 *     evidence timestamp bypasses the redaction selection.
 *   - Projects structured facts instead of forwarding opaque payloads.
 *     Free-text service notes are excluded unless explicitly consented to
 *     and reviewed; human review is not automated content sanitization.
 */
import type { Vehicle } from '@/types/vehicle';
import type { BatteryPassport } from '@/api/hooks/useBatteryPassport';
import type { MaintenanceItem, ServiceRecord, SoftwareUpdate } from '@/types/vehicle-systems';
import type { Drive, DriveScore, DrivingStats } from '@/types/driving';
import type { ChargingSession } from '@/types/charging';
import type { GuardEvent } from '@/api/hooks/useGuard';
import { asFiniteNumber } from '@/lib/typeGuards';
import { applyDatePrecision, resolveVinDisclosure } from './redaction';
import type {
  BatteryEvidence,
  ChargingHistoryEvidence,
  DrivingHistoryEvidence,
  MaintenanceEvidence,
  SecurityIncidentsEvidence,
  SoftwareUpdateEvidence,
  VehicleIdentityEvidence,
  WarrantyEvidence,
} from './types';
import type { DatePrecision, VinDisclosure } from './types';

const METERS_PER_KM = 1000;
const WH_PER_KWH = 1000;

/**
 * Explicit disclosure approval for reviewed, shareable service-note text.
 * Keys bind review to the exact source record, so a refreshed/changed record
 * cannot inherit an earlier approval. Reviewers must remove hard-excluded
 * content; consent alone does not make arbitrary text safe.
 */
interface ServiceNoteDisclosure {
  consent: boolean;
  reviewedNotes: ReadonlyMap<ServiceRecord, { sourceNotes: string; reviewedText: string }>;
}

function disclosedServiceNote(record: ServiceRecord, disclosure?: ServiceNoteDisclosure): string {
  if (disclosure?.consent !== true) return '';
  const review = disclosure.reviewedNotes.get(record);
  return review && review.sourceNotes === record.notes ? review.reviewedText : '';
}

// Both field names AND values are constrained: a benign key is not proof
// that an arbitrary string or nested payload is safe to disclose.
const WARRANTY_PLANS = new Set(['Basic', 'Battery', 'Drive Unit', 'Extended']);

/**
 * True for DC fast charging (Supercharger/CCS) session types, matching the
 * same `charger_type` string-matching convention already established in
 * `features/battery/lib/batteryCare.ts::isDcSession` (re-implemented here,
 * not imported, to keep this feature free of cross-feature dependencies).
 */
function isDcFastChargeSession(chargerType: string | null): boolean {
  if (!chargerType) return false;
  const t = chargerType.toLowerCase();
  return t.includes('dc') || t.includes('super') || t.includes('fast') || t.includes('ccs');
}

/** Without coverage fields, a partial aggregate must remain unknown. */
function completeTotal(values: unknown[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) {
    const measured = asFiniteNumber(value);
    if (measured == null) return null;
    total += measured;
  }
  return asFiniteNumber(total);
}

function minMaxDates(dates: string[]): { earliest: string | null; latest: string | null } {
  if (dates.length === 0) return { earliest: null, latest: null };
  const sorted = [...dates].sort();
  return { earliest: sorted[0]!, latest: sorted[sorted.length - 1]! };
}

/** Vehicle identity — VIN handled exclusively through `resolveVinDisclosure()`; no other identity-adjacent field (location, owner) is read from `Vehicle`. */
export function normalizeVehicleIdentity(
  vehicle: Vehicle | null | undefined,
  vinDisclosure: VinDisclosure,
): VehicleIdentityEvidence | null {
  if (!vehicle) return null;
  const vinFields = resolveVinDisclosure(vehicle.vin, vinDisclosure);
  return {
    vin_disclosure: vinDisclosure,
    ...vinFields,
    display_name: vehicle.display_name ?? vehicle.displayName ?? null,
    model: vehicle.model ?? null,
    trim_badging: vehicle.trim_badging ?? vehicle.trimBadging ?? null,
    exterior_color: vehicle.exterior_color ?? vehicle.exteriorColor ?? null,
    wheel_type: vehicle.wheel_type ?? vehicle.wheelType ?? null,
  };
}

/** Battery Passport → `BatteryEvidence`. kWh figures are multiplied by an exact ×1000 metric prefix to store true SI watt-hours. */
export function normalizeBattery(
  passport: BatteryPassport | null | undefined,
  precision: DatePrecision,
): BatteryEvidence | null {
  if (!passport) return null;
  return {
    soh_pct: passport.soh_pct ?? null,
    capacity_wh: passport.capacity_kwh != null ? passport.capacity_kwh * WH_PER_KWH : null,
    original_capacity_wh: passport.original_capacity_kwh != null ? passport.original_capacity_kwh * WH_PER_KWH : null,
    equivalent_full_cycles: passport.equivalent_full_cycles ?? null,
    fast_charge_ratio: passport.fast_charge_ratio ?? null,
    avg_charge_limit_pct: passport.avg_charge_limit_pct ?? null,
    health_grade: passport.health_grade ?? null,
    thermal_exposure: passport.thermal_exposure
      ? {
          cold_pct: passport.thermal_exposure.cold_pct,
          nominal_pct: passport.thermal_exposure.nominal_pct,
          hot_pct: passport.thermal_exposure.hot_pct,
        }
      : null,
    degradation_trend: (passport.degradation_trend ?? []).map((p) => ({
      date: applyDatePrecision(p.date, precision) ?? p.date,
      soh_pct: p.soh_pct,
    })),
    recommendations: [...(passport.recommendations ?? [])],
    source_provenance_hash: passport.provenance_hash ?? null,
    issued_at: applyDatePrecision(passport.issued_at, precision),
    first_observed_at: applyDatePrecision(passport.first_observed_at, precision),
  };
}

/** Maintenance schedule + service history. Notes require separate consent/review, not just section selection. Both source endpoints are fleet-wide; `reportBuilder.ts` surfaces that limitation. */
export function normalizeMaintenance(
  items: MaintenanceItem[] | undefined,
  records: ServiceRecord[] | undefined,
  precision: DatePrecision,
  noteDisclosure?: ServiceNoteDisclosure,
): MaintenanceEvidence | null {
  const hasItems = items != null && items.length > 0;
  const hasRecords = records != null && records.length > 0;
  if (!hasItems && !hasRecords) return null;

  const categories = Array.from(new Set((items ?? []).map((i) => i.category).filter(Boolean))).sort();

  return {
    scheduled_item_count: items?.length ?? 0,
    service_record_count: records?.length ?? 0,
    service_records: (records ?? []).map((r) => ({
      item_id: r.itemId,
      date: applyDatePrecision(r.date, precision) ?? r.date,
      odometer_m: r.odometerKm != null ? r.odometerKm * METERS_PER_KM : null,
      notes: disclosedServiceNote(r, noteDisclosure),
    })),
    categories,
  };
}

/** Software update history (vehicle-scoped — `/software-updates?vehicle_id=`). */
export function normalizeSoftwareUpdates(updates: SoftwareUpdate[] | undefined): SoftwareUpdateEvidence | null {
  if (!updates || updates.length === 0) return null;
  const installed = updates.filter((u) => u.status === 'installed' && u.installedAt);
  const sortedByInstall = [...installed].sort((a, b) => (b.installedAt ?? '').localeCompare(a.installedAt ?? ''));
  return {
    update_count: updates.length,
    installed_versions: installed.map((u) => ({ version: u.version, installed_at: u.installedAt })),
    latest_version: sortedByInstall[0]?.version ?? null,
  };
}

/**
 * Opaque warranty input -> an explicit bounded-value disclosure contract.
 * Unknown fields, nested values and free text are excluded, not declared
 * content-safe by key-name scrubbing. Extend only with verified safe contracts.
 */
export function normalizeWarranty(
  envelope: { data: Record<string, unknown> | null; fetched_at: string | null } | null | undefined,
  precision: DatePrecision,
): WarrantyEvidence | null {
  if (!envelope || !envelope.data) return null;
  return {
    fetched_at: applyDatePrecision(envelope.fetched_at, precision),
    data: typeof envelope.data.plan === 'string' && WARRANTY_PLANS.has(envelope.data.plan)
      ? { plan: envelope.data.plan }
      : {},
  };
}

/** Driving history — aggregated from `DrivingStats`/`DriveScore` (server-computed over the full history, not just the fetched page) plus per-drive timestamps from `Drive[]` for the earliest/latest bound. Distance is converted from the stats hook's km figure to true SI meters by an exact ×1000 multiplication. */
export function normalizeDrivingHistory(
  drives: Drive[] | undefined,
  stats: DrivingStats | undefined | null,
  score: DriveScore | undefined | null,
  precision: DatePrecision,
): DrivingHistoryEvidence | null {
  const hasDrives = drives != null && drives.length > 0;
  if (!hasDrives && !stats) return null;

  const { earliest, latest } = minMaxDates((drives ?? []).map((d) => d.startTs).filter(Boolean));

  return {
    observed_drive_count: stats?.totalDrives ?? drives?.length ?? 0,
    total_distance_m: stats?.totalDistanceKm != null ? stats.totalDistanceKm * METERS_PER_KM : null,
    total_duration_s: stats?.totalDurationS ?? null,
    avg_efficiency_wh_per_km: stats?.avgEfficiencyWhKm ?? null,
    regen_ratio: stats?.regenRatio ?? null,
    co2_saved_kg: stats?.co2SavedKg ?? null,
    score_overall: score?.overall ?? null,
    score_grade: score?.grade ?? null,
    earliest_drive_at: applyDatePrecision(earliest, precision),
    latest_drive_at: applyDatePrecision(latest, precision),
  };
}

/** Charging history — complete finite measurements only, in already-SI Wh/W. Cost remains an unconverted amount with unknown denomination; missing measurements never become zero. */
export function normalizeChargingHistory(
  sessions: ChargingSession[] | undefined,
  precision: DatePrecision,
): ChargingHistoryEvidence | null {
  if (!sessions || sessions.length === 0) return null;

  const totalEnergyWh = completeTotal(sessions.map((s) => s.total_energy_added_wh));
  const totalPeakPower = completeTotal(sessions.map((s) => s.peak_power_w));
  const fastChargeCount = sessions.filter((s) => isDcFastChargeSession(s.charger_type)).length;
  const totalCost = completeTotal(sessions.map((s) => s.cost ?? s.cost_decimal));
  const timestamps = sessions.map((s) => s.started_at ?? s.start_ts).filter(Boolean);
  const { earliest, latest } = minMaxDates(timestamps);

  return {
    observed_session_count: sessions.length,
    total_energy_added_wh: totalEnergyWh,
    fast_charge_session_count: fastChargeCount,
    avg_peak_power_w: totalPeakPower == null ? null : totalPeakPower / sessions.length,
    total_cost: totalCost,
    earliest_session_at: applyDatePrecision(earliest, precision),
    latest_session_at: applyDatePrecision(latest, precision),
  };
}

/** Security/guard events — counts and type breakdown only; `details`/`acknowledged_by` (potentially free-form/identity-bearing) are deliberately never read here. */
export function normalizeSecurityIncidents(
  events: GuardEvent[] | undefined,
  precision: DatePrecision,
): SecurityIncidentsEvidence | null {
  if (!events || events.length === 0) return null;

  const byTypeMap = new Map<string, number>();
  for (const ev of events) {
    byTypeMap.set(ev.event_type, (byTypeMap.get(ev.event_type) ?? 0) + 1);
  }
  const by_type = Array.from(byTypeMap.entries())
    .map(([event_type, count]) => ({ event_type, count }))
    .sort((a, b) => b.count - a.count);

  const { earliest, latest } = minMaxDates(events.map((e) => e.ts).filter(Boolean));

  return {
    observed_event_count: events.length,
    by_type,
    acknowledged_count: events.filter((e) => e.acknowledged_at != null).length,
    earliest_event_at: applyDatePrecision(earliest, precision),
    latest_event_at: applyDatePrecision(latest, precision),
  };
}
