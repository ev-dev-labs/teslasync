/**
 * Pure, unit-testable helpers for the Vehicle Ingest Cost page.
 *
 * The API returns SI-agnostic operational counters (row counts, byte
 * estimates, ingest rates, DLQ failures) — there are no physical measurement
 * units here, so no `useUnits()` conversion is required. Bytes are rendered
 * with `formatBytes` at the display boundary.
 */
import type { VehicleCostRow } from '@/types/admin-operator-confidence';

/**
 * A single vehicle's ingest footprint, normalised + null-safe, prepared for
 * the cost chart and the top-talkers share list.
 */
export interface VehicleCostBar {
  vehicle_id: number;
  name: string;
  bytes: number;
  rows: number;
  rate: number;
  failures: number;
}

/**
 * Common async-state props shared by every data-bound section so each panel
 * owns its loading / empty / error rendering independently of the page.
 */
export interface SectionState {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Resolve a stable, human display label for a vehicle row. */
export function vehicleName(
  row: Pick<VehicleCostRow, 'display_name' | 'vehicle_id'>,
  fallback: string,
): string {
  const name = row.display_name?.trim();
  return name && name.length > 0 ? name : fallback;
}

/**
 * Normalise + sort the per-vehicle footprint list. `by` selects the sort key:
 * `'bytes'` powers the cost chart (largest consumer first) and `'rows'` powers
 * the top-talkers share list. Every optional field is coerced to a number so
 * downstream consumers never hit `undefined` in a chart or `.toFixed`.
 */
export function rankVehicles(
  vehicles: readonly VehicleCostRow[],
  nameOf: (row: VehicleCostRow) => string,
  by: 'bytes' | 'rows',
  limit: number,
): VehicleCostBar[] {
  return (vehicles ?? [])
    .map((v) => ({
      vehicle_id: v.vehicle_id,
      name: nameOf(v),
      bytes: v.signal_bytes_est ?? 0,
      rows: v.signal_row_count ?? 0,
      rate: v.ingest_rate_per_minute_24h ?? 0,
      failures: v.dlq_failures_24h ?? 0,
    }))
    .sort((a, b) => (by === 'bytes' ? b.bytes - a.bytes : b.rows - a.rows))
    .slice(0, Math.max(0, limit));
}

/** Fleet-average rows per vehicle over the window — null-safe on divide. */
export function avgRowsPerVehicle(totalRows: number, vehicleCount: number): number {
  return vehicleCount > 0 ? totalRows / vehicleCount : 0;
}
