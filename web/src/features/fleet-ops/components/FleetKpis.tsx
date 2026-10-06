import { useTranslation } from 'react-i18next';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { DataState } from '@/api/dataState';
import type {
  FleetAssignment,
  FleetForecastPoint,
  FleetPage,
  FleetReservation,
  FleetUtilizationForecast,
  FleetWorkOrder,
} from '@/api/hooks/useFleetOps';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { formatDateTime } from '@/lib/dateFormat';
import { fleetKpis } from '../helpers';

type SourceState = Pick<DataState<unknown>,
  'status' | 'isRefreshing' | 'isRefreshBlocked' | 'updatedAt'>;
type ListCoverage = Pick<FleetPage<unknown>, 'total' | 'limit' | 'offset'>;

interface FleetKpisProps {
  reservations: FleetReservation[];
  assignments: FleetAssignment[];
  workOrders: FleetWorkOrder[];
  forecast: FleetForecastPoint[];
  loading: boolean;
  availability: {
    reservations: boolean;
    assignments: boolean;
    workOrders: boolean;
    forecast: boolean;
  };
  sources: {
    reservations: SourceState;
    assignments: SourceState;
    workOrders: SourceState;
    forecast: SourceState;
  };
  coverage: {
    reservations?: ListCoverage;
    assignments?: ListCoverage;
    workOrders?: ListCoverage;
  };
  forecastSource?: FleetUtilizationForecast;
}

export function FleetKpis({
  reservations,
  assignments,
  workOrders,
  forecast,
  loading,
  availability,
  sources,
  coverage,
  forecastSource,
}: FleetKpisProps) {
  const { t } = useTranslation();
  const values = fleetKpis(reservations, assignments, workOrders, forecast);
  const sourceLabels = {
    initial: t('fleetOps.brief.source.initial', 'Awaiting source'),
    initialFailure: t('fleetOps.brief.source.initialFailure', 'Source unavailable'),
    unavailable: t('fleetOps.brief.source.unavailable', 'Source reports no data'),
    partial: t('fleetOps.brief.source.partial', 'Partial source data'),
    stale: t('fleetOps.brief.source.stale', 'Retained source data'),
    ok: t('fleetOps.brief.source.ok', 'Loaded source data'),
  };
  const sourceContext = (state: SourceState) => [
    sourceLabels[state.status],
    state.isRefreshBlocked
      ? t('fleetOps.brief.refreshBlocked', 'Refresh paused')
      : state.isRefreshing
        ? t('fleetOps.brief.refreshing', 'Refreshing source data')
        : undefined,
    state.updatedAt != null
      ? t('fleetOps.brief.receivedAt', 'Received {{time}}', { time: formatDateTime(new Date(state.updatedAt)) })
      : t('fleetOps.brief.receivedUnknown', 'Source receipt time unavailable'),
  ].filter(Boolean).join(' · ');
  const loadedCoverage = (count: number, page?: ListCoverage) => page
    ? t('fleetOps.brief.listCoverage', '{{loaded}} loaded of {{total}} source records; offset {{offset}}, limit {{limit}}', {
      loaded: count, total: page.total, offset: page.offset, limit: page.limit,
    })
    : t('fleetOps.brief.coverageUnknown', 'List coverage unavailable');
  const listWindow = t('fleetOps.brief.listWindow', 'Operational lists are not date-filtered.');
  const forecastWindow = forecastSource
    ? t('fleetOps.brief.forecastWindow', 'Forecast source window: {{from}} – {{to}}', {
      from: formatDateTime(forecastSource.from), to: formatDateTime(forecastSource.to),
    })
    : t('fleetOps.brief.forecastWindowUnknown', 'Forecast source window unavailable');
  const metrics: readonly StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'reservations',
      label: t('fleetOps.kpi.reservations', 'Active reservations'),
      rawValue: availability.reservations ? values.active_reservations : null,
      description: t('fleetOps.brief.reservationsMeaning', 'Requested or confirmed reservations in the loaded records.'),
      context: `${loadedCoverage(reservations.length, coverage.reservations)} · ${listWindow} · ${sourceContext(sources.reservations)}`,
    },
    {
      metricId: 'count', occurrenceId: 'assignments',
      label: t('fleetOps.kpi.assignedVehicles', 'Assigned vehicles'),
      rawValue: availability.assignments ? values.assigned_vehicles : null,
      description: t('fleetOps.brief.assignmentsMeaning', 'Distinct vehicle IDs in the loaded assignments; not a count of assignments active at this instant.'),
      context: `${loadedCoverage(assignments.length, coverage.assignments)} · ${listWindow} · ${sourceContext(sources.assignments)}`,
    },
    {
      metricId: 'count', occurrenceId: 'work-orders',
      label: t('fleetOps.kpi.openWorkOrders', 'Open work orders'),
      rawValue: availability.workOrders ? values.open_work_orders : null,
      description: t('fleetOps.brief.workOrdersMeaning', 'Loaded work orders excluding completed and cancelled orders.'),
      context: `${loadedCoverage(workOrders.length, coverage.workOrders)} · ${listWindow} · ${sourceContext(sources.workOrders)}`,
    },
    {
      metricId: 'percent', occurrenceId: 'forecast',
      label: t('fleetOps.kpi.forecastUtilization', 'Forecast utilization'),
      rawValue: availability.forecast ? values.expected_utilization_pct : null,
      description: t('fleetOps.brief.forecastMeaning', 'Arithmetic mean of expected utilization across returned vehicle-day points, rounded to one decimal.'),
      context: <>
        <div>{t('fleetOps.kpi.forecastAverage', '14-day fleet average')}</div>
        <div>{forecastWindow}</div>
        <div>{sourceContext(sources.forecast)}</div>
        {forecastSource && <>
          <div>{t('fleetOps.brief.forecastGenerated', 'Forecast generated {{time}}', {
            time: formatDateTime(forecastSource.generated_at),
          })}</div>
          <div>{t('fleetOps.brief.forecastPoints', '{{count}} returned vehicle-day points', { count: forecast.length })}</div>
          {(forecastSource.limitations ?? []).length > 0 && (
            <div>{t('fleetOps.brief.forecastLimitations', 'Forecast limitations: {{limitations}}', {
              limitations: forecastSource.limitations.join(' '),
            })}</div>
          )}
        </>}
      </>,
    },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const sourceStates = Object.values(sources);
  const availableCount = operationalMetrics.filter((metric) => metric.valueState === 'value').length;
  const partialLists = [
    [coverage.reservations, reservations.length],
    [coverage.assignments, assignments.length],
    [coverage.workOrders, workOrders.length],
  ] as const;
  const hasPartialList = partialLists.some(([page, count]) =>
    page != null && (page.offset !== 0 || page.total !== count));
  const retained = sourceStates.some((state) => state.status === 'stale' || state.isRefreshBlocked);
  const partial = availableCount !== metrics.length || hasPartialList
    || sourceStates.some((state) => state.status === 'partial');
  const statusLabel = retained ? sourceLabels.stale
    : loading || sourceStates.some((state) => state.isRefreshing)
      ? t('fleetOps.brief.refreshing', 'Refreshing source data')
      : partial ? t('fleetOps.brief.partialCoverage', 'Partial source coverage')
        : sourceLabels.ok;

  return (
    <OperationalBrief
      compact
      testId="fleet-operations-summary"
      eyebrow={t('fleetOps.brief.eyebrow', 'Fleet coordination')}
      title={t('fleetOps.brief.title', 'Operational record summary')}
      description={t('fleetOps.brief.description', 'Counts cover loaded operational records; utilization comes from the fleet forecast. These sources have independent windows and refresh times.')}
      statusLabel={statusLabel}
      statusTone={retained || partial ? 'warning' : 'neutral'}
      scope={t('fleetOps.brief.scope', 'Fleet-wide · {{scope}}', {
        scope: t('fleetOps.kpi.loadedScope', 'Loaded operational records'),
      })}
      freshness={t('fleetOps.brief.freshness', 'Independent source snapshots')}
      provenance={t('fleetOps.brief.provenance', 'Fleet assignment, reservation and work-order API records; inferred utilization forecast. Loaded counts are not server-wide totals.')}
      loading={loading && availableCount === 0}
      metrics={operationalMetrics}
    />
  );
}
