import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';

/**
 * Carbon Intelligence — grid-aware CO2 accounting for charging. These hooks
 * read the three backend routes registered in internal/api/router.go (under the
 * versioned API group):
 *
 *   GET /carbon/intensity                                   (shared grid model)
 *   GET /vehicles/{vehicleID}/carbon/summary?from=&to=      (per-vehicle CO2)
 *   GET /vehicles/{vehicleID}/carbon/recommendation         (greenest window)
 *
 * `request()` prepends `/api/v1` automatically, so the paths below MUST NOT
 * include it. Query params are snake_case (`from`, `to`) to match the Go
 * handler, and every field name mirrors the Go JSON tags.
 */

/** One hour of the diurnal grid carbon-intensity curve. */
export interface CarbonHourIntensity {
  /**
   * Backend/model clock-hour 0..23. The endpoint does not expose the
   * timezone used by its EXTRACT(HOUR FROM started_at) attribution.
   */
  hour_of_day: number;
  /** Grams of CO2 attributed per kWh drawn during this hour. */
  g_co2_per_kwh: number;
}

/** The full 24-hour grid model plus its derived extremes. */
export interface CarbonIntensityCurve {
  curve: CarbonHourIntensity[];
  /** Cleanest hourly intensity across the day (gCO2/kWh). */
  min: number;
  /** Dirtiest hourly intensity across the day (gCO2/kWh). */
  max: number;
  /** Hours (0..23) achieving the minimum intensity. Always present, maybe empty. */
  greenest_hours: number[];
  /** Hours (0..23) achieving the maximum intensity. Always present, maybe empty. */
  dirtiest_hours: number[];
}

/** One YYYY-MM row of the CO2 trend. */
export interface CarbonMonthly {
  /** YYYY-MM calendar month. */
  month: string;
  co2_kg: number;
  energy_kwh: number;
}

/** Per-vehicle carbon summary over the optional [from,to] window. */
export interface CarbonSummary {
  total_energy_kwh: number;
  total_co2_kg: number;
  /** Distance-based ICE baseline (0.192 kg CO2/km). */
  gas_equiv_co2_kg: number;
  /** gas_equiv_co2_kg - total_co2_kg (can be negative on a very dirty grid). */
  co2_saved_kg: number;
  /** 0..100 timing score — 100 = always charged at the greenest hour. */
  green_score: number;
  sessions_scored: number;
  monthly: CarbonMonthly[];
}

/** The recommended contiguous charging window (end hour is exclusive). */
export interface CarbonGreenestWindow {
  start_hour: number;
  end_hour: number;
  avg_intensity: number;
}

/** How the driver's realized charging compares to the greenest window. */
export interface CarbonRecommendation {
  current_avg_intensity: number;
  greenest_window: CarbonGreenestWindow;
  potential_co2_saving_kg: number;
  potential_saving_pct: number;
}

/**
 * The shared, vehicle-independent diurnal grid model. It is a seeded,
 * admin-editable table, so it changes rarely — cache it as effectively static.
 */
export function useCarbonIntensity() {
  return useQuery({
    queryKey: ['carbon-intensity'],
    queryFn: ({ signal }) => request<CarbonIntensityCurve>('/carbon/intensity', { signal }),
    staleTime: STALE_TIMES.STATIC,
  });
}

/**
 * Per-vehicle CO2 summary. Optional `from`/`to` (YYYY-MM-DD or RFC 3339) scope
 * the window; omit both for full history. Disabled until a vehicle is known so
 * an empty selection never fires a request.
 */
export function useCarbonSummary(vehicleId: number | null, from?: string, to?: string) {
  return useQuery({
    queryKey: ['carbon-summary', vehicleId, from ?? null, to ?? null],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      return request<CarbonSummary>(
        qs
          ? `/vehicles/${vehicleId}/carbon/summary?${qs}`
          : `/vehicles/${vehicleId}/carbon/summary`,
        { signal },
      );
    },
    enabled: vehicleId !== null && vehicleId > 0,
    staleTime: STALE_TIMES.ANALYTICS,
  });
}

/**
 * The greenest charging window for a vehicle and the CO2 shifting into it would
 * save. Disabled until a vehicle is known.
 */
export function useCarbonRecommendation(vehicleId: number | null) {
  return useQuery({
    queryKey: ['carbon-recommendation', vehicleId],
    queryFn: ({ signal }) =>
      request<CarbonRecommendation>(`/vehicles/${vehicleId}/carbon/recommendation`, { signal }),
    enabled: vehicleId !== null && vehicleId > 0,
    staleTime: STALE_TIMES.ANALYTICS,
  });
}
