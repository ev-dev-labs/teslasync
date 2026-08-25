import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';

export type DriverStatus = 'active' | 'inactive';
export type ReservationStatus = 'requested' | 'confirmed' | 'cancelled' | 'completed';
export type WorkOrderStatus = 'open' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type WorkOrderSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ForecastQuality = 'sparse' | 'fair' | 'good';

export interface FleetPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface FleetDriver {
  id: number;
  display_name: string;
  reference_code: string;
  status: DriverStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface FleetCostCenter {
  id: number;
  code: string;
  name: string;
  active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface FleetAssignment {
  id: number;
  vehicle_id: number;
  vehicle_display_name: string;
  driver_id: number;
  driver_display_name: string;
  starts_at: string;
  ends_at: string | null;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface FleetReservation {
  id: number;
  vehicle_id: number;
  vehicle_display_name: string;
  driver_id: number | null;
  driver_display_name: string | null;
  cost_center_id: number | null;
  cost_center_name: string | null;
  title: string;
  purpose: string | null;
  starts_at: string;
  ends_at: string;
  status: ReservationStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ChargingPolicyWindow {
  id?: number;
  charging_policy_id?: number;
  day_of_week: number;
  start_local_time: string;
  end_local_time: string;
  created_at?: string;
  updated_at?: string;
}

export interface FleetChargingPolicy {
  id: number;
  vehicle_id: number;
  vehicle_display_name: string;
  name: string;
  target_soc_pct: number;
  max_power_w: number | null;
  priority: number;
  effective_from: string;
  effective_to: string | null;
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  windows: ChargingPolicyWindow[];
}

export interface FleetWorkOrder {
  id: number;
  vehicle_id: number;
  vehicle_display_name: string;
  cost_center_id: number | null;
  cost_center_name: string | null;
  title: string;
  description: string | null;
  status: WorkOrderStatus;
  severity: WorkOrderSeverity;
  due_odometer_m: number | null;
  due_at: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  cost_minor: number | null;
  currency: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface FleetForecastPoint {
  vehicle_id: number;
  vehicle_display_name: string;
  forecast_date: string;
  available_s: number;
  reserved_s: number;
  maintenance_downtime_s: number;
  historical_expected_s: number;
  expected_utilization_pct: number;
  lower_utilization_pct: number;
  upper_utilization_pct: number;
}

export interface FleetUtilizationForecast {
  from: string;
  to: string;
  generated_at: string;
  quality: ForecastQuality;
  history_drive_count: number;
  history_day_count: number;
  limitations: string[];
  points: FleetForecastPoint[];
}

export interface ListFilter {
  limit?: number;
  offset?: number;
}

export interface DriverFilter extends ListFilter {
  status?: DriverStatus;
  search?: string;
}

export interface CostCenterFilter extends ListFilter {
  active?: boolean;
  search?: string;
}

export interface AssignmentFilter extends ListFilter {
  vehicle_id?: number;
  driver_id?: number;
  at?: string;
}

export interface ReservationFilter extends ListFilter {
  vehicle_id?: number;
  driver_id?: number;
  cost_center_id?: number;
  status?: ReservationStatus;
  from?: string;
  to?: string;
}

export interface ChargingPolicyFilter extends ListFilter {
  vehicle_id?: number;
  enabled?: boolean;
  active_at?: string;
}

export interface WorkOrderFilter extends ListFilter {
  vehicle_id?: number;
  cost_center_id?: number;
  status?: WorkOrderStatus;
  severity?: WorkOrderSeverity;
}

export type FleetDriverInput = Pick<FleetDriver, 'display_name' | 'reference_code' | 'status'>;
export type FleetCostCenterInput = Pick<FleetCostCenter, 'code' | 'name' | 'active'>;
export type FleetAssignmentInput = Pick<
  FleetAssignment,
  'vehicle_id' | 'driver_id' | 'starts_at' | 'ends_at' | 'notes'
>;
export type FleetReservationInput = Pick<
  FleetReservation,
  | 'vehicle_id'
  | 'driver_id'
  | 'cost_center_id'
  | 'title'
  | 'purpose'
  | 'starts_at'
  | 'ends_at'
  | 'status'
>;
export type FleetChargingPolicyInput = Pick<
  FleetChargingPolicy,
  | 'vehicle_id'
  | 'name'
  | 'target_soc_pct'
  | 'max_power_w'
  | 'priority'
  | 'effective_from'
  | 'effective_to'
  | 'enabled'
  | 'windows'
>;
export type FleetWorkOrderInput = Pick<
  FleetWorkOrder,
  | 'vehicle_id'
  | 'cost_center_id'
  | 'title'
  | 'description'
  | 'status'
  | 'severity'
  | 'due_odometer_m'
  | 'due_at'
  | 'scheduled_start_at'
  | 'scheduled_end_at'
  | 'cost_minor'
  | 'currency'
>;

type VersionedUpdate<T> = { id: number; version: number; input: T };
type VersionedDelete = { id: number; version: number };

export const fleetOpsKeys = {
  all: ['fleet-ops'] as const,
  drivers: (filter: DriverFilter = {}) => ['fleet-ops', 'drivers', filter] as const,
  driver: (id: number) => ['fleet-ops', 'drivers', id] as const,
  costCenters: (filter: CostCenterFilter = {}) => ['fleet-ops', 'cost-centers', filter] as const,
  costCenter: (id: number) => ['fleet-ops', 'cost-centers', id] as const,
  assignments: (filter: AssignmentFilter = {}) => ['fleet-ops', 'assignments', filter] as const,
  assignment: (id: number) => ['fleet-ops', 'assignments', id] as const,
  reservations: (filter: ReservationFilter = {}) => ['fleet-ops', 'reservations', filter] as const,
  reservation: (id: number) => ['fleet-ops', 'reservations', id] as const,
  policies: (filter: ChargingPolicyFilter = {}) => ['fleet-ops', 'charging-policies', filter] as const,
  policy: (id: number) => ['fleet-ops', 'charging-policies', id] as const,
  workOrders: (filter: WorkOrderFilter = {}) => ['fleet-ops', 'work-orders', filter] as const,
  workOrder: (id: number) => ['fleet-ops', 'work-orders', id] as const,
  forecast: (vehicleId?: number, from?: string, to?: string) =>
    ['fleet-ops', 'utilization-forecast', vehicleId ?? null, from ?? null, to ?? null] as const,
};

function queryString(filter: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(filter).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
}

function useListQuery<T, F extends object>(resource: string, key: readonly unknown[], filter: F) {
  return useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      request<FleetPage<T>>(
        `/fleet-ops/${resource}${queryString(filter as Record<string, string | number | boolean | undefined>)}`,
        { signal },
      ),
  });
}

function useDetailQuery<T>(resource: string, id?: number) {
  return useQuery({
    queryKey: ['fleet-ops', resource, id],
    queryFn: ({ signal }) => request<T>(`/fleet-ops/${resource}/${id}`, { signal }),
    enabled: !!id,
  });
}

function useFleetMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    networkMode: 'always',
    onSuccess: () => queryClient.invalidateQueries({ queryKey: fleetOpsKeys.all }),
  });
}

function useCreateMutation<TData, TInput>(resource: string) {
  return useFleetMutation<TData, TInput>((input) =>
    request<TData>(`/fleet-ops/${resource}`, {
      method: 'POST',
      requiresLiveMode: true,
      body: JSON.stringify(input),
    }),
  );
}

function useUpdateMutation<TData, TInput>(resource: string) {
  return useFleetMutation<TData, VersionedUpdate<TInput>>(({ id, version, input }) =>
    request<TData>(`/fleet-ops/${resource}/${id}`, {
      method: 'PUT',
      requiresLiveMode: true,
      body: JSON.stringify({ ...input, version }),
    }),
  );
}

function useDeleteMutation(resource: string) {
  return useFleetMutation<void, VersionedDelete>(({ id, version }) =>
    request<void>(`/fleet-ops/${resource}/${id}?version=${version}`, {
      method: 'DELETE',
      requiresLiveMode: true,
    }),
  );
}

export function useFleetDrivers(filter: DriverFilter = {}) {
  return useListQuery<FleetDriver, DriverFilter>('drivers', fleetOpsKeys.drivers(filter), filter);
}
export function useFleetDriver(id?: number) { return useDetailQuery<FleetDriver>('drivers', id); }
export function useCreateFleetDriver() { return useCreateMutation<FleetDriver, FleetDriverInput>('drivers'); }
export function useUpdateFleetDriver() { return useUpdateMutation<FleetDriver, FleetDriverInput>('drivers'); }
export function useDeleteFleetDriver() { return useDeleteMutation('drivers'); }

export function useFleetCostCenters(filter: CostCenterFilter = {}) {
  return useListQuery<FleetCostCenter, CostCenterFilter>('cost-centers', fleetOpsKeys.costCenters(filter), filter);
}
export function useFleetCostCenter(id?: number) { return useDetailQuery<FleetCostCenter>('cost-centers', id); }
export function useCreateFleetCostCenter() { return useCreateMutation<FleetCostCenter, FleetCostCenterInput>('cost-centers'); }
export function useUpdateFleetCostCenter() { return useUpdateMutation<FleetCostCenter, FleetCostCenterInput>('cost-centers'); }
export function useDeleteFleetCostCenter() { return useDeleteMutation('cost-centers'); }

export function useFleetAssignments(filter: AssignmentFilter = {}) {
  return useListQuery<FleetAssignment, AssignmentFilter>('assignments', fleetOpsKeys.assignments(filter), filter);
}
export function useFleetAssignment(id?: number) { return useDetailQuery<FleetAssignment>('assignments', id); }
export function useCreateFleetAssignment() { return useCreateMutation<FleetAssignment, FleetAssignmentInput>('assignments'); }
export function useUpdateFleetAssignment() { return useUpdateMutation<FleetAssignment, FleetAssignmentInput>('assignments'); }
export function useDeleteFleetAssignment() { return useDeleteMutation('assignments'); }

export function useFleetReservations(filter: ReservationFilter = {}) {
  return useListQuery<FleetReservation, ReservationFilter>('reservations', fleetOpsKeys.reservations(filter), filter);
}
export function useFleetReservation(id?: number) { return useDetailQuery<FleetReservation>('reservations', id); }
export function useCreateFleetReservation() { return useCreateMutation<FleetReservation, FleetReservationInput>('reservations'); }
export function useUpdateFleetReservation() { return useUpdateMutation<FleetReservation, FleetReservationInput>('reservations'); }
export function useDeleteFleetReservation() { return useDeleteMutation('reservations'); }

export function useFleetChargingPolicies(filter: ChargingPolicyFilter = {}) {
  return useListQuery<FleetChargingPolicy, ChargingPolicyFilter>('charging-policies', fleetOpsKeys.policies(filter), filter);
}
export function useFleetChargingPolicy(id?: number) { return useDetailQuery<FleetChargingPolicy>('charging-policies', id); }
export function useCreateFleetChargingPolicy() {
  return useCreateMutation<FleetChargingPolicy, FleetChargingPolicyInput>('charging-policies');
}
export function useUpdateFleetChargingPolicy() {
  return useUpdateMutation<FleetChargingPolicy, FleetChargingPolicyInput>('charging-policies');
}
export function useDeleteFleetChargingPolicy() { return useDeleteMutation('charging-policies'); }

export function useFleetWorkOrders(filter: WorkOrderFilter = {}) {
  return useListQuery<FleetWorkOrder, WorkOrderFilter>('work-orders', fleetOpsKeys.workOrders(filter), filter);
}
export function useFleetWorkOrder(id?: number) { return useDetailQuery<FleetWorkOrder>('work-orders', id); }
export function useCreateFleetWorkOrder() { return useCreateMutation<FleetWorkOrder, FleetWorkOrderInput>('work-orders'); }
export function useUpdateFleetWorkOrder() { return useUpdateMutation<FleetWorkOrder, FleetWorkOrderInput>('work-orders'); }
export function useDeleteFleetWorkOrder() { return useDeleteMutation('work-orders'); }

export function useFleetUtilizationForecast(vehicleId?: number, from?: string, to?: string) {
  const params = queryString({ vehicle_id: vehicleId, from, to });
  return useQuery({
    queryKey: fleetOpsKeys.forecast(vehicleId, from, to),
    queryFn: ({ signal }) =>
      request<FleetUtilizationForecast>(`/fleet-ops/utilization-forecast${params}`, { signal }),
  });
}
