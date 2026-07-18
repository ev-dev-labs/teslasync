import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';

/**
 * Remaining Useful Life (RUL) — predictive component prognostics. These hooks
 * read the two backend routes registered in internal/api/router.go (under the
 * versioned API group, in the `/vehicles/{vehicleID}` sub-router):
 *
 *   GET /vehicles/{vehicleID}/rul               (whole component health board)
 *   GET /vehicles/{vehicleID}/rul/{component}   (one component + forecast series)
 *
 * `request()` prepends `/api/v1` automatically, so the paths below MUST NOT
 * include it. Every field name is snake_case to mirror the Go JSON tags, and
 * nullable Go pointers surface as `T | null`.
 */

/** Health classification of a component. Matches the Go `status` enum. */
export type RULStatus = 'healthy' | 'watch' | 'replace_soon' | 'overdue';

/** Stable machine keys for the tracked components (Go componentSpecs order). */
export type RULComponent = 'hv_battery' | 'lv_battery' | 'tires' | 'brakes' | 'cabin_filter';

/** One component's prognosis, returned by both endpoints. */
export interface ComponentRUL {
  /** Stable machine key (e.g. `hv_battery`). */
  component: string;
  /** Human label (e.g. `High-Voltage Battery`). */
  label: string;
  /** Display health: % State of Health (battery) or % of nominal life left. */
  health_pct: number;
  /** Decline in health_pct per day (SoH %/day or life %/day). */
  wear_rate_per_day: number;
  /** Projected days until the end-of-life threshold. 0 when overdue. */
  remaining_days: number;
  /** Projected km until EOL for distance-wear parts; null otherwise. */
  remaining_km: number | null;
  /** YYYY-MM-DD "replace-by" date; null when the rate is indeterminate. */
  projected_eol_date: string | null;
  /** 0..1 trust in the estimate. */
  confidence: number;
  /** healthy | watch | replace_soon | overdue. */
  status: RULStatus;
  /** Human-readable sentence explaining how the estimate was derived. */
  basis: string;
}

/** The single most-urgent upcoming replacement. */
export interface NextService {
  component: string;
  /** YYYY-MM-DD; null when nothing is projectable. */
  date: string | null;
}

/** Body of GET /vehicles/{vehicleID}/rul. */
export interface RULResponse {
  vehicle_id: number;
  /** Always present (possibly empty), in the deliberate componentSpecs order. */
  components: ComponentRUL[];
  /** Null when no component has a projectable EOL date. */
  next_service: NextService | null;
}

/** One sample of a forecast curve, with a confidence band. */
export interface ProjectionPoint {
  /** YYYY-MM-DD. */
  date: string;
  projected_health: number;
  confidence_low: number;
  confidence_high: number;
}

/** Body of GET /vehicles/{vehicleID}/rul/{component}. */
export interface ComponentDetailResponse extends ComponentRUL {
  /** EOL threshold in the component's own health unit; null when unset. */
  eol_threshold: number | null;
  /** Configured nominal distance life (km); null for calendar-wear parts. */
  nominal_life_km: number | null;
  /** Configured nominal calendar life (days); null for distance-wear parts. */
  nominal_life_days: number | null;
  /** Free-text rationale echoed from the config table. */
  notes: string;
  /** Forecast from today to the projected EOL for the chart. */
  projection: ProjectionPoint[];
}

/**
 * The whole component health board for a vehicle. Disabled until a vehicle is
 * known so an empty selection never fires a request.
 */
export function useRUL(vehicleId: number | null) {
  return useQuery({
    queryKey: ['rul', vehicleId],
    queryFn: ({ signal }) => request<RULResponse>(`/vehicles/${vehicleId}/rul`, { signal }),
    enabled: vehicleId !== null && vehicleId > 0,
    staleTime: STALE_TIMES.ANALYTICS,
  });
}

/**
 * One component's detailed prognosis plus its forecast series. Disabled until
 * both a vehicle and a component are selected.
 */
export function useComponentRUL(vehicleId: number | null, component: string | null) {
  return useQuery({
    queryKey: ['rul-component', vehicleId, component],
    queryFn: ({ signal }) =>
      request<ComponentDetailResponse>(`/vehicles/${vehicleId}/rul/${component}`, { signal }),
    enabled: vehicleId !== null && vehicleId > 0 && !!component,
    staleTime: STALE_TIMES.ANALYTICS,
  });
}
