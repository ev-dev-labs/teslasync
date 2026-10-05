import { useQuery } from '@tanstack/react-query';
import { request } from '../client';

/** Existing endpoint units: km, kWh, Wh/km and kg; no conversion in this hook. */
export interface PeriodStats {
  total_distance: number;
  total_drives: number;
  energy_used: number;
  avg_efficiency: number;
  total_cost: number;
  co2_saved: number;
}

export function usePeriodStats(vehicleId: string, days: number) {
  return useQuery({
    queryKey: ['period-stats', vehicleId, days],
    queryFn: () => request<PeriodStats>(
      `/analytics/period-stats?vehicle_id=${vehicleId}&days=${days}`,
    ),
    enabled: !!vehicleId,
  });
}
