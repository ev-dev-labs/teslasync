import { useQuery } from '@tanstack/react-query';
import { request } from '../client';

export type MaintenanceStatus = 'good' | 'soon' | 'overdue' | 'completed';

/**
 * Full raw schedule shape emitted by maintenance.Handler.defaultItems.
 * Distance fields are SI metres, including the legacy `interval_miles` name.
 * Keep conversions at the render boundary; do not rename the wire fields.
 */
export interface MaintenanceItem {
  id: number;
  vehicle_id: number;
  category: string;
  name: string;
  description: string;
  due_date: string | null;
  due_mileage: number | null;
  current_mileage: number;
  last_service_date: string | null;
  last_service_mileage: number | null;
  interval_months: number | null;
  interval_miles: number | null;
  status: MaintenanceStatus;
  created_at: string;
}

/**
 * Preserved full MaintenancePage service-history contract.
 * Records currently emits only []; there is no record producer against which
 * mileage units or populated fields can be independently verified.
 */
export interface ServiceRecord {
  id: number;
  vehicle_id: number;
  date: string;
  description: string;
  mileage: number;
  cost: number;
  provider: string;
  notes: string;
  created_at: string;
}

/** Preserve the page's identity, null gate and inherited QueryClient policy. */
export function useMaintenance(vehicleId: number | null) {
  return useQuery({
    queryKey: ['maintenance', vehicleId],
    queryFn: ({ signal }) => request<MaintenanceItem[]>(
      `/maintenance${vehicleId === null ? '' : `?vehicle_id=${vehicleId}`}`,
      { signal },
    ),
    enabled: vehicleId !== null,
  });
}

/** Typed read only: the backend currently returns an empty service history. */
export function useServiceRecords(vehicleId: number | null) {
  return useQuery({
    queryKey: ['maintenance-records', vehicleId],
    queryFn: ({ signal }) => request<ServiceRecord[]>(
      `/maintenance/records${vehicleId === null ? '' : `?vehicle_id=${vehicleId}`}`,
      { signal },
    ),
    enabled: vehicleId !== null,
  });
}
