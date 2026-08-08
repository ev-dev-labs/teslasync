import type {
  FleetAssignment,
  FleetChargingPolicy,
  FleetCostCenter,
  FleetDriver,
  FleetReservation,
  FleetWorkOrder,
} from '@/api/hooks/useFleetOps';

export type FleetDeleteTarget =
  | { kind: 'driver'; item: FleetDriver }
  | { kind: 'assignment'; item: FleetAssignment }
  | { kind: 'cost_center'; item: FleetCostCenter }
  | { kind: 'reservation'; item: FleetReservation }
  | { kind: 'charging_policy'; item: FleetChargingPolicy }
  | { kind: 'work_order'; item: FleetWorkOrder };

export type FleetEditor =
  | { kind: 'driver'; item: FleetDriver | null }
  | { kind: 'assignment'; item: FleetAssignment | null }
  | { kind: 'cost_center'; item: FleetCostCenter | null }
  | { kind: 'reservation'; item: FleetReservation | null }
  | { kind: 'charging_policy'; item: FleetChargingPolicy | null }
  | { kind: 'work_order'; item: FleetWorkOrder | null };

export interface VehicleChoice {
  id: number;
  display_name?: string;
  vin?: string;
}
