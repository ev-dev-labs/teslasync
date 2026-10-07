import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useFleetAssignments,
  useFleetChargingPolicies,
  useFleetCostCenters,
  useFleetDrivers,
  useFleetReservations,
  useFleetUtilizationForecast,
  useFleetWorkOrders,
  type FleetReservation,
} from '@/api/hooks/useFleetOps';
import { useVehicles } from '@/api/hooks/useVehicles';
import { Button } from '@/components/ui';
import { Grid, PageLayout } from '@/components/layout';
import { OperationalWriteNotice, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useDataState } from '@/hooks/useDataState';
import {
  AssignmentRoster,
  CancelReservationDialog,
  ChargingPolicyMatrix,
  CostCenterAllocation,
  DeleteFleetResourceDialog,
  DriverRoster,
  FleetKpis,
  FleetResourceEditorDialog,
  ReservationPanel,
  UtilizationForecastChart,
  WorkOrderBoard,
  type FleetDeleteTarget,
  type FleetEditor,
} from '../components';

const gridColumns = { default: 1, xl: 2 } as const;

function forecastWindow() {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 14);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function FleetOperationsPage() {
  const { t } = useTranslation();
  usePageTitle(t('fleetOps.title', 'Fleet operations'));
  const [editor, setEditor] = useState<FleetEditor | null>(null);
  const [cancelTarget, setCancelTarget] = useState<FleetReservation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FleetDeleteTarget | null>(null);
  const operationalMode = useOperationalMode();
  const window = useMemo(forecastWindow, []);
  const vehiclesQuery = useVehicles();
  const driversQuery = useFleetDrivers({ limit: 100 });
  const assignmentsQuery = useFleetAssignments({ limit: 100 });
  const reservationsQuery = useFleetReservations({ limit: 100 });
  const costCentersQuery = useFleetCostCenters({ limit: 100 });
  const policiesQuery = useFleetChargingPolicies({ limit: 100 });
  const workOrdersQuery = useFleetWorkOrders({ limit: 100 });
  const forecastQuery = useFleetUtilizationForecast(undefined, window.from, window.to);
  const vehiclesState = useDataState(vehiclesQuery);
  const driversState = useDataState(driversQuery);
  const assignmentsState = useDataState(assignmentsQuery);
  const reservationsState = useDataState(reservationsQuery);
  const costCentersState = useDataState(costCentersQuery);
  const policiesState = useDataState(policiesQuery);
  const workOrdersState = useDataState(workOrdersQuery);
  const forecastState = useDataState(forecastQuery, { provenance: 'inferred' });

  const drivers = driversQuery.data?.items ?? [];
  const assignments = assignmentsQuery.data?.items ?? [];
  const reservations = reservationsQuery.data?.items ?? [];
  const costCenters = costCentersQuery.data?.items ?? [];
  const policies = policiesQuery.data?.items ?? [];
  const workOrders = workOrdersQuery.data?.items ?? [];
  const forecastPoints = forecastQuery.data?.points ?? [];
  const vehicles = vehiclesQuery.data ?? [];
  const kpiLoading = assignmentsQuery.isLoading || reservationsQuery.isLoading ||
    workOrdersQuery.isLoading || forecastQuery.isLoading;
  const refreshFleetOps = () => {
    void vehiclesQuery.refetch();
    void driversQuery.refetch();
    void assignmentsQuery.refetch();
    void reservationsQuery.refetch();
    void costCentersQuery.refetch();
    void policiesQuery.refetch();
    void workOrdersQuery.refetch();
    void forecastQuery.refetch();
  };
  const closeEditors = () => {
    setEditor(null);
    setCancelTarget(null);
  };
  useEffect(() => {
    if (operationalMode.canWrite) return;
    setEditor(null);
    setCancelTarget(null);
    setDeleteTarget(null);
  }, [operationalMode.canWrite]);
  const refreshAndCloseEditor = () => {
    refreshFleetOps();
    setEditor(null);
  };

  return (
    <PageLayout
      title={t('fleetOps.title', 'Fleet operations')}
      subtitle={t('fleetOps.subtitle', 'Coordinate drivers, bookings, charging, costs, maintenance, and capacity.')}
      primaryAction={(
        <Button
          type="button"
          icon={<CalendarPlus className="h-4 w-4" />}
          onClick={() => setEditor({ kind: 'reservation', item: null })}
          disabled={
            !operationalMode.canWrite
            || vehiclesQuery.isLoading
            || (vehiclesQuery.data ?? []).length === 0
          }
          title={operationalMode.writeBlockReason ?? undefined}
        >
          {t('fleetOps.actions.reserve', 'New reservation')}
        </Button>
      )}
      query={[
        driversQuery,
        assignmentsQuery,
        reservationsQuery,
        costCentersQuery,
        policiesQuery,
        workOrdersQuery,
        forecastQuery,
      ]}
    >
      <OperationalWriteNotice
        title={t('fleetOps.readOnly.title', 'Fleet operations is read-only')}
      />
      <StaleRefreshWarning state={vehiclesState} label={t('nav.vehicles', 'Fleet')} />
      <StaleRefreshWarning state={driversState} label={t('fleetOps.drivers.title', 'Fleet drivers')} />
      <StaleRefreshWarning state={assignmentsState} label={t('fleetOps.assignments.title', 'Assignment roster')} />
      <StaleRefreshWarning state={reservationsState} label={t('fleetOps.reservations.title', 'Reservation calendar')} />
      <StaleRefreshWarning state={costCentersState} label={t('fleetOps.costCenters.title', 'Cost-center allocation')} />
      <StaleRefreshWarning state={policiesState} label={t('fleetOps.policies.title', 'Charging policy matrix')} />
      <StaleRefreshWarning state={workOrdersState} label={t('fleetOps.workOrders.title', 'Maintenance work-order board')} />
      <StaleRefreshWarning state={forecastState} label={t('fleetOps.forecast.title', 'Utilization forecast')} />

      <FadeIn>
        <FleetKpis
          reservations={reservations}
          assignments={assignments}
          workOrders={workOrders}
          forecast={forecastPoints}
          loading={kpiLoading}
          availability={{
            reservations: reservationsState.hasData,
            assignments: assignmentsState.hasData,
            workOrders: workOrdersState.hasData,
            forecast: forecastState.hasData,
          }}
          sources={{
            reservations: reservationsState,
            assignments: assignmentsState,
            workOrders: workOrdersState,
            forecast: forecastState,
          }}
          coverage={{
            reservations: reservationsQuery.data,
            assignments: assignmentsQuery.data,
            workOrders: workOrdersQuery.data,
          }}
          forecastSource={forecastQuery.data}
        />
      </FadeIn>

      <FadeIn delay={0.03}>
        <ReservationPanel
          items={reservations}
          enableValueFilters={reservationsQuery.data?.offset === 0 && reservationsQuery.data.total === reservations.length}
          loading={reservationsQuery.isLoading}
          error={reservationsState.fatalError}
          onRetry={() => void reservationsQuery.refetch()}
          onAdd={() => setEditor({ kind: 'reservation', item: null })}
          onEdit={(item) => setEditor({ kind: 'reservation', item })}
          onCancel={setCancelTarget}
          onDelete={(item) => setDeleteTarget({ kind: 'reservation', item })}
          actionsDisabled={!operationalMode.canWrite}
          actionsDisabledReason={operationalMode.writeBlockReason ?? undefined}
        />
      </FadeIn>

      <Grid cols={gridColumns} gap={4}>
        <FadeIn delay={0.05}>
          <DriverRoster
            items={drivers}
            enableValueFilters={driversQuery.data?.offset === 0 && driversQuery.data.total === drivers.length}
            loading={driversQuery.isLoading}
            error={driversState.fatalError}
            onRetry={() => void driversQuery.refetch()}
            onAdd={() => setEditor({ kind: 'driver', item: null })}
            onEdit={(item) => setEditor({ kind: 'driver', item })}
            onDelete={(item) => setDeleteTarget({ kind: 'driver', item })}
            actionsDisabled={!operationalMode.canWrite}
            actionsDisabledReason={operationalMode.writeBlockReason ?? undefined}
          />
        </FadeIn>
        <FadeIn delay={0.06}>
          <AssignmentRoster
            items={assignments}
            enableValueFilters={assignmentsQuery.data?.offset === 0 && assignmentsQuery.data.total === assignments.length}
            loading={assignmentsQuery.isLoading}
            error={assignmentsState.fatalError}
            onRetry={() => void assignmentsQuery.refetch()}
            onAdd={() => setEditor({ kind: 'assignment', item: null })}
            onEdit={(item) => setEditor({ kind: 'assignment', item })}
            onDelete={(item) => setDeleteTarget({ kind: 'assignment', item })}
            actionsDisabled={!operationalMode.canWrite}
            actionsDisabledReason={operationalMode.writeBlockReason ?? undefined}
          />
        </FadeIn>
        <FadeIn delay={0.07}>
          <CostCenterAllocation
            costCenters={costCenters}
            reservations={reservations}
            workOrders={workOrders}
            loading={costCentersQuery.isLoading || reservationsQuery.isLoading || workOrdersQuery.isLoading}
            error={costCentersState.fatalError ?? reservationsState.fatalError ?? workOrdersState.fatalError}
            onRetry={() => {
              void costCentersQuery.refetch();
              void reservationsQuery.refetch();
              void workOrdersQuery.refetch();
            }}
            onAdd={() => setEditor({ kind: 'cost_center', item: null })}
            onEdit={(item) => setEditor({ kind: 'cost_center', item })}
            onDelete={(item) => setDeleteTarget({ kind: 'cost_center', item })}
            actionsDisabled={!operationalMode.canWrite}
            actionsDisabledReason={operationalMode.writeBlockReason ?? undefined}
          />
        </FadeIn>
      </Grid>

      <FadeIn delay={0.09}>
        <ChargingPolicyMatrix
          items={policies}
          enableValueFilters={policiesQuery.data?.offset === 0 && policiesQuery.data.total === policies.length}
          loading={policiesQuery.isLoading}
          error={policiesState.fatalError}
          onRetry={() => void policiesQuery.refetch()}
          onAdd={() => setEditor({ kind: 'charging_policy', item: null })}
          onEdit={(item) => setEditor({ kind: 'charging_policy', item })}
          onDelete={(item) => setDeleteTarget({ kind: 'charging_policy', item })}
          actionsDisabled={!operationalMode.canWrite}
          actionsDisabledReason={operationalMode.writeBlockReason ?? undefined}
        />
      </FadeIn>

      <FadeIn delay={0.11}>
        <WorkOrderBoard
          items={workOrders}
          loading={workOrdersQuery.isLoading}
          error={workOrdersState.fatalError}
          onRetry={() => void workOrdersQuery.refetch()}
          onAdd={() => setEditor({ kind: 'work_order', item: null })}
          onEdit={(item) => setEditor({ kind: 'work_order', item })}
          onDelete={(item) => setDeleteTarget({ kind: 'work_order', item })}
          actionsDisabled={!operationalMode.canWrite}
          actionsDisabledReason={operationalMode.writeBlockReason ?? undefined}
        />
      </FadeIn>

      <FadeIn delay={0.13}>
        <UtilizationForecastChart
          forecast={forecastQuery.data}
          loading={forecastQuery.isLoading}
          error={forecastState.fatalError}
          onRetry={() => void forecastQuery.refetch()}
        />
      </FadeIn>

      {operationalMode.canWrite && editor && (
        <FleetResourceEditorDialog
          key={`${editor.kind}-${editor.item?.id ?? 'new'}`}
          editor={editor}
          vehicles={vehicles}
          drivers={drivers}
          assignments={assignments}
          costCenters={costCenters}
          onClose={() => setEditor(null)}
          onCancelReservation={setCancelTarget}
          onDelete={setDeleteTarget}
          onRefresh={refreshFleetOps}
        />
      )}
      {operationalMode.canWrite && cancelTarget && (
        <CancelReservationDialog
          item={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={closeEditors}
          onRefresh={refreshAndCloseEditor}
        />
      )}
      {operationalMode.canWrite && deleteTarget && (
        <DeleteFleetResourceDialog
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            closeEditors();
          }}
          onRefresh={refreshAndCloseEditor}
        />
      )}
    </PageLayout>
  );
}
