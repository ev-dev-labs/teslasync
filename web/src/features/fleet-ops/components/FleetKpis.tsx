import { CalendarClock, Car, Gauge, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Grid } from '@/components/layout';
import { StatCard } from '@/components/data-display';
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
}

export function FleetKpis({
  reservations,
  assignments,
  workOrders,
  forecast,
  loading,
}: FleetKpisProps) {
  const { t } = useTranslation();
  const values = fleetKpis(reservations, assignments, workOrders, forecast);
  return (
    <Grid cols={{ default: 1, sm: 2, lg: 4 }} gap={4}>
      <StatCard
        label={t('fleetOps.kpi.reservations', 'Active reservations')}
        value={values.active_reservations}
        icon={<CalendarClock className="h-5 w-5" />}
        loading={loading}
      />
      <StatCard
        label={t('fleetOps.kpi.assignedVehicles', 'Assigned vehicles')}
        value={values.assigned_vehicles}
        icon={<Car className="h-5 w-5" />}
        loading={loading}
      />
      <StatCard
        label={t('fleetOps.kpi.openWorkOrders', 'Open work orders')}
        value={values.open_work_orders}
        icon={<Wrench className="h-5 w-5" />}
        loading={loading}
      />
      <StatCard
        label={t('fleetOps.kpi.forecastUtilization', 'Forecast utilization')}
        value={values.expected_utilization_pct}
        unit="%"
        icon={<Gauge className="h-5 w-5" />}
        loading={loading}
        sublabel={t('fleetOps.kpi.forecastAverage', '14-day fleet average')}
      />
    </Grid>
  );
}
