import { useTranslation } from 'react-i18next';
import { StatStrip } from '@/components/data-display';
import type {
  FleetAssignment,
  FleetForecastPoint,
  FleetReservation,
  FleetWorkOrder,
} from '@/api/hooks/useFleetOps';
import { fleetKpis } from '../helpers';

interface FleetKpisProps {
  reservations: FleetReservation[];
  assignments: FleetAssignment[];
  workOrders: FleetWorkOrder[];
  forecast: FleetForecastPoint[];
  loading: boolean;
  availability?: {
    reservations: boolean;
    assignments: boolean;
    workOrders: boolean;
    forecast: boolean;
  };
}

export function FleetKpis({
  reservations,
  assignments,
  workOrders,
  forecast,
  loading,
  availability,
}: FleetKpisProps) {
  const { t } = useTranslation();
  const values = fleetKpis(reservations, assignments, workOrders, forecast);
  return (
    <StatStrip
      id="fleet-operations-summary"
      loading={loading}
      period={{ kind: 'unknown', label: t('fleetOps.kpi.loadedScope', 'Loaded operational records'),
        reason: t('fleetOps.kpi.forecastAverage', '14-day fleet average') }}
      metrics={[
        { metricId: 'count', occurrenceId: 'reservations', label: t('fleetOps.kpi.reservations', 'Active reservations'),
          rawValue: availability?.reservations === false ? null : values.active_reservations },
        { metricId: 'count', occurrenceId: 'assignments', label: t('fleetOps.kpi.assignedVehicles', 'Assigned vehicles'),
          rawValue: availability?.assignments === false ? null : values.assigned_vehicles },
        { metricId: 'count', occurrenceId: 'work-orders', label: t('fleetOps.kpi.openWorkOrders', 'Open work orders'),
          rawValue: availability?.workOrders === false ? null : values.open_work_orders },
        { metricId: 'percent', occurrenceId: 'forecast', label: t('fleetOps.kpi.forecastUtilization', 'Forecast utilization'),
          rawValue: availability?.forecast === false ? null : values.expected_utilization_pct,
          context: t('fleetOps.kpi.forecastAverage', '14-day fleet average') },
      ]}
    />
  );
}
