import { useQuery } from '@tanstack/react-query';
import { request } from '../client';

/** Existing page DTO, preserved verbatim. Pressure corners are canonical Pa. */
export interface TirePressureReading {
  id: number;
  vehicle_id: number;
  front_left?: number | null;
  front_right?: number | null;
  rear_left?: number | null;
  rear_right?: number | null;
  tpms_hard_warnings?: string | null;
  tpms_soft_warnings?: string | null;
  created_at: string;
}

// Preserve the page's strict null gate, inherited QueryClient policy and
// one-argument request calls (no new polling or signal consumption).
export function usePressurePageLatest(activeVehicleId: number | null) {
  return useQuery({
    queryKey: ['tire-pressure-latest', activeVehicleId],
    queryFn: () =>
      request<TirePressureReading | null>(
        `/tire-pressure/latest?vehicle_id=${activeVehicleId}`,
      ),
    enabled: activeVehicleId !== null,
  });
}

// Range ownership/defaults remain in useRangeState at the page. Both literal
// bounds participate in the URL and identity; this hook invents no window.
export function usePressurePageHistory(
  activeVehicleId: number | null,
  start: string,
  end: string,
) {
  return useQuery({
    queryKey: ['tire-pressure-history', activeVehicleId, start, end],
    queryFn: () =>
      request<TirePressureReading[]>(
        `/tire-pressure?vehicle_id=${activeVehicleId}&start=${start}&end=${end}`,
      ),
    enabled: activeVehicleId !== null,
  });
}
