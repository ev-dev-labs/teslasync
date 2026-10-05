import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLayout } from '@/components/layout/layout-reference';
import { FadeIn } from '@/components/motion';
import { useDrivetrainHealth, useDrives, useDrivingStats } from '@/api/hooks/useDriving';
import { useMotorLatest, useMotorHistory } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useRangeState } from '@/hooks/useRangeState';
import { useDataState } from '@/hooks/useDataState';
import {
  HealthSummary, ThermalPanels, LiveMotorPanel, ChartPanels, HistoryRecords, DetailPanels, MethodologyPanel,
} from '../components/drivetrain-health-modernization';
import {
  sensorsFor, driveSeries, motorSeries, powerSummary,
} from '../components/drivetrain-health-modernization/model';

/** Orchestration only. Workspace controls remain owned by the actual app header;
 * all original queries, defaults, polling and derived record ordering survive. */
export default function DrivetrainHealthPage() {
  const { t } = useTranslation();
  const { formatTime, formatDateShort } = useDateFormat();
  usePageTitle(t('drivetrain.title', 'Drivetrain Health'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { start: startDate, end: endDate } = useRangeState({
    persistKey: 'drivetrain-health.range',
  });

  // Deliberately retain these exact calls. Query keys, cancellation, enablement,
  // retry and defaults live in the existing hooks, which are read-only here.
  const healthQuery = useDrivetrainHealth(vehicleIdStr);
  const drivesQuery = useDrives(vehicleIdStr);
  const statsQuery = useDrivingStats(vehicleIdStr);
  const motorLatestQuery = useMotorLatest(vehicleId ?? 0, 5_000);
  const motorHistoryQuery = useMotorHistory(vehicleId ?? 0, 200);
  const { state: liveState, connected } = useVehicleLive(vehicleId ?? undefined);

  const healthState = useDataState(healthQuery, { provenance: 'inferred' });
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const statsState = useDataState(statsQuery, { provenance: 'historical' });
  const motorLatestState = useDataState(motorLatestQuery);
  const motorHistoryState = useDataState(motorHistoryQuery, { provenance: 'historical' });

  const health = healthQuery.data;
  const stats = statsQuery.data;
  const sensors = useMemo(() => sensorsFor(health), [health]);
  const chartData = useMemo(
    () => driveSeries(drivesQuery.data, startDate, endDate, formatDateShort),
    [drivesQuery.data, startDate, endDate, formatDateShort],
  );
  const power = useMemo(() => powerSummary(chartData), [chartData]);
  const motorChartData = useMemo(
    () => motorSeries(motorHistoryQuery.data, formatTime),
    [motorHistoryQuery.data, formatTime],
  );

  // Never supply a page-wide loading/error/empty gate: an independent failed
  // source keeps every neighbor and shell reachable. Refresh failures retain
  // their own data and expose retry next to that source's content.
  return (
    <PageLayout
      title={t('drivetrain.title', 'Drivetrain Health')}
      subtitle={t('drivetrain.subtitle', 'Motor, inverter, and battery thermal status')}
      query={healthQuery}
      busy={[healthQuery, drivesQuery, statsQuery, motorLatestQuery, motorHistoryQuery].some(query => query.isFetching)}
      className="w-full min-w-0"
    >
      <FadeIn className="min-w-0 space-y-6">
        {/* 1–3: overview, complete metric band, health gauge, motor details, stats. */}
        <HealthSummary
          health={health} stats={stats} sensors={sensors} power={power}
          healthState={healthState} statsState={statsState} drivesState={drivesState}
          healthLoading={healthQuery.isLoading} statsLoading={statsQuery.isLoading}
        />

        {/* 4: both thermal sections; source-independent power/stats stay visible. */}
        <ThermalPanels
          sensors={sensors} power={power} stats={stats}
          healthState={healthState} statsState={statsState} drivesState={drivesState}
          loading={healthQuery.isLoading}
        />

        {/* 5: all thirteen motor readings and original isolation policy. */}
        <LiveMotorPanel
          motorLatest={motorLatestQuery.data} isolationResistance={liveState.isolationResistance}
          state={motorLatestState} loading={motorLatestQuery.isLoading} connected={connected}
        />

        {/* 6: all four charts, original series IDs/legend preferences and actions. */}
        <ChartPanels
          motorRows={motorChartData} driveRows={chartData}
          motorState={motorHistoryState} drivesState={drivesState}
          motorLoading={motorHistoryQuery.isLoading} drivesLoading={drivesQuery.isLoading}
        />
        <HistoryRecords
          motorRows={motorChartData} driveRows={chartData}
          motorState={motorHistoryState} drivesState={drivesState}
          motorLoading={motorHistoryQuery.isLoading} drivesLoading={drivesQuery.isLoading}
        />

        {/* 7: every original detail and exact specialist recommendation producer. */}
        <DetailPanels
          health={health} stats={stats} sensors={sensors} power={power}
          healthState={healthState} drivesState={drivesState} statsState={statsState}
          loading={healthQuery.isLoading}
        />
        <MethodologyPanel />
      </FadeIn>
    </PageLayout>
  );
}
