import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';

/**
 * Battery Passport — the server's current certificate-reported SoH evidence
 * and digest comparison. These hooks read the two backend routes registered
 * in internal/api/router.go (mounted under the versioned API group):
 *
 *   GET /vehicles/{vehicleID}/battery-passport
 *   GET /vehicles/{vehicleID}/battery-passport/verify?hash=<hex>
 *
 * `request()` prepends the version prefix automatically, so the paths below
 * must NOT include it. All field names are snake_case to mirror the Go JSON
 * tags.
 */

/** Share of drives whose ambient temperature fell in each band (0..100). */
export interface BatteryPassportThermalExposure {
  cold_pct: number;
  nominal_pct: number;
  hot_pct: number;
}

/** One day of the State-of-Health degradation trend. */
export interface BatteryPassportTrendPoint {
  /** YYYY-MM-DD calendar day (UTC). */
  date: string;
  /** Estimated pack SoH for that day (0..100). */
  soh_pct: number;
}

/** Complete Battery Passport certificate payload. */
export interface BatteryPassport {
  vehicle_id: number;
  vin_masked: string;
  /** RFC 3339 issue instant. */
  issued_at: string;
  /**
   * RFC 3339 first-observed instant, or `null` for a vehicle with no drives
   * and no charging sessions yet — render the header null-safely.
   */
  first_observed_at: string | null;
  soh_pct: number;
  capacity_kwh: number;
  original_capacity_kwh: number;
  equivalent_full_cycles: number;
  /** Fraction (0..1) of charging sessions that were DC fast-charges. */
  fast_charge_ratio: number;
  avg_charge_limit_pct: number;
  thermal_exposure: BatteryPassportThermalExposure;
  /** Overall health grade A..F, or "N/A" when SoH cannot be estimated. */
  health_grade: string;
  degradation_trend: BatteryPassportTrendPoint[];
  recommendations: string[];
  /** Lowercase hex SHA-256 binding the certificate's immutable core facts. */
  provenance_hash: string;
}

/** Digest result: `valid` is true when current recomputation matches. */
export interface BatteryPassportVerifyResponse {
  valid: boolean;
  expected_hash: string;
  provided_hash: string;
}

/** Fetch the current Battery Passport certificate for a vehicle. */
export function useBatteryPassport(vehicleId: string | null) {
  return useQuery({
    queryKey: ['battery-passport', vehicleId],
    queryFn: ({ signal }) =>
      request<BatteryPassport>(`/vehicles/${vehicleId}/battery-passport`, { signal }),
    enabled: vehicleId !== null,
    staleTime: STALE_TIMES.ANALYTICS,
  });
}

/**
 * Recompute the current passport hash server-side and compare it to `hash`
 * (digest agreement). Disabled until both the vehicle and a non-empty hash
 * are available, so verification starts only after the certificate has
 * yielded its `provenance_hash`.
 */
export function useVerifyPassport(vehicleId: string | null, hash: string | null) {
  return useQuery({
    queryKey: ['battery-passport-verify', vehicleId, hash],
    queryFn: ({ signal }) =>
      request<BatteryPassportVerifyResponse>(
        `/vehicles/${vehicleId}/battery-passport/verify?hash=${encodeURIComponent(hash ?? '')}`,
        { signal },
      ),
    enabled: vehicleId !== null && hash !== null && hash !== '',
    staleTime: STALE_TIMES.ANALYTICS,
  });
}
