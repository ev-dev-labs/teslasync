/**
 * Pure, unit-testable helpers for the Vehicle Ingest Cost page.
 *
 * The API returns SI-agnostic operational counters (row counts, byte
 * estimates, ingest rates, DLQ failures) — there are no physical measurement
 * units here, so no `useUnits()` conversion is required. Bytes are rendered
 * with `formatBytes` at the display boundary.
 */
import type { VehicleCostRow } from '@/types/admin-operator-confidence';
import { isFiniteNumber } from '@/lib/numberFormat';

/**
 * A single vehicle's ingest footprint, normalised + null-safe, prepared for
 * the cost chart and the top-talkers share list.
 */
export interface VehicleCostBar {
  vehicle_id: number;
  name: string;
  bytes: number | null;
  rows: number | null;
  rate: number | null;
  failures: number | null;
}

/** Unknown readings remain distinct from measured zero at the display boundary. */
export function costReading(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

export function formatCostReading(value: unknown, format: (value: number) => string): string {
  const reading = costReading(value);
  return reading === null ? '—' : format(reading);
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
 * the top-talkers share list. Missing/nonfinite readings remain null. Unknown
 * sort keys follow all measured values (including zero and negatives); ties
 * retain source order. No source rows are discarded before the requested limit.
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
      bytes: costReading(v.signal_bytes_est),
      rows: costReading(v.signal_row_count),
      rate: costReading(v.ingest_rate_per_minute_24h),
      failures: costReading(v.dlq_failures_24h),
    }))
    .sort((a, b) => {
      const left = a[by];
      const right = b[by];
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      return right - left;
    })
    .slice(0, Math.max(0, limit));
}

/** Fleet-average rows per vehicle over the window — null-safe on divide. */
export function avgRowsPerVehicle(totalRows: number, vehicleCount: number): number {
  return vehicleCount > 0 ? totalRows / vehicleCount : 0;
}
