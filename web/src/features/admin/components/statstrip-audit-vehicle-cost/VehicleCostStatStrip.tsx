import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { QueryError } from '@/components/feedback';
import type { VehicleCostTotals } from '@/types/admin-operator-confidence';
import { avgRowsPerVehicle } from '../vehicle-cost/helpers';

interface Props {
  totals: VehicleCostTotals | undefined;
  vehicleCount: number | null;
  windowDays: number;
  loading: boolean;
  error: unknown;
  refreshError?: Error | null;
  retained?: boolean;
  onRetry: () => void;
}

export function VehicleCostStatStrip({ totals, vehicleCount, windowDays, loading, error, refreshError, retained = false, onRetry }: Props) {
  const { t } = useTranslation();
  const windowLabel = t('admin.vehicleCost.windowSub', 'Window: {{days}}d', { days: windowDays });
  const denominatorScope = t('admin.vehicleCost.denominatorScope', 'Denominator: returned vehicles (query limit 100); not an unbounded fleet count');
  const totalScope = t('admin.vehicleCost.totalScope', 'Totals sum the returned vehicles only (query limit 100), not the unbounded fleet');
  const meanScope = t('admin.vehicleCost.meanScope', 'Returned-vehicle total rows divided by returned vehicle count; arithmetic mean within this limited report');
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'total-rows', rawValue: totals?.total_rows,
      label: t('admin.vehicleCost.totalRows', 'Total rows'), context: <>{windowLabel} · {totalScope}</>, description: totalScope },
    { metricId: 'bytes', occurrenceId: 'estimated-bytes', rawValue: totals?.total_bytes_est,
      label: t('admin.vehicleCost.totalBytes', 'Total bytes (est.)'),
      context: <>{t('admin.vehicleCost.bytesSub', '96 bytes/row average')} · {totalScope}</>,
      description: t('admin.vehicleCost.bytesDescription', 'Estimated storage for returned vehicles over the selected ingest window, using the existing 96 bytes per row estimate; not measured on-disk size.') },
    { metricId: 'number', occurrenceId: 'rows-rate', rawValue: totals?.total_rate_per_minute_24h,
      label: t('admin.vehicleCost.totalRate', 'Rate (rows/min, 24h)'),
      context: <>{t('admin.vehicleCost.rateSub', 'Across all vehicles')} · {t('admin.vehicleCost.returnedQualifier', 'in the returned report (up to 100 vehicles)')}</>,
      description: t('admin.vehicleCost.rateDescription', 'Ingest rows per minute in the last 24 hours among returned vehicles and selected-window rows; not an unbounded fleet rate.') },
    { metricId: 'count', occurrenceId: 'dlq-failures', rawValue: totals?.total_failures_24h,
      label: t('admin.vehicleCost.totalFailures', 'DLQ failures (24h)'),
      context: <>{t('admin.vehicleCost.failuresSub', 'Codec or writer rejections')} · {totalScope}</>,
      description: t('admin.vehicleCost.failuresDescription', 'Reported DLQ failures over the last 24 hours for vehicles returned in the selected window; not an unbounded fleet failure count.') },
    { metricId: 'count', occurrenceId: 'returned-vehicles', rawValue: vehicleCount,
      label: t('admin.vehicleCost.vehiclesTracked', 'Vehicles tracked'),
      context: <>{t('admin.vehicleCost.vehiclesSub', 'Ingesting in window')} · {denominatorScope}</>,
      description: denominatorScope },
    { metricId: 'number', occurrenceId: 'mean-rows',
      rawValue: totals?.total_rows == null || vehicleCount == null || vehicleCount === 0
        ? null : avgRowsPerVehicle(totals.total_rows, vehicleCount),
      missingReason: vehicleCount === 0 ? t('admin.vehicleCost.noDenominator', 'No returned vehicles to average') : undefined,
      display: { precision: 0 }, label: t('admin.vehicleCost.avgRows', 'Avg rows / vehicle'),
      context: <>{t('admin.vehicleCost.avgSub', 'Fleet baseline')} · {meanScope}</>,
      description: meanScope },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return <section aria-label={t('admin.vehicleCost.kpiRegion', 'Fleet ingest totals')}>
    <OperationalBrief compact metricColumns={3} testId="vehicle-cost-summary" metrics={operationalMetrics} loading={loading && !retained}
      eyebrow={t('admin.vehicleCost.pageTitle', 'Vehicle ingest cost')}
      title={t('admin.vehicleCost.kpiRegion', 'Fleet ingest totals')}
      description={t('admin.vehicleCost.periodReason', 'Rows, estimated bytes and vehicle baseline use the selected window; rate and DLQ failures use the last 24 hours for returned vehicles. The response does not provide exact report bounds.')}
      statusLabel={retained ? t('operationalSummary.retained', 'Retained source data')
        : error != null ? t('operationalSummary.unavailable', 'Source unavailable')
          : loading ? t('operationalSummary.loading', 'Loading sources')
            : totals == null ? t('operationalSummary.unknown', 'Source values unknown') : t('operationalSummary.snapshot', 'Queried snapshot')}
      statusTone={retained || error != null ? 'warning' : 'neutral'} scope={windowLabel}
      freshness={retained ? t('developerReference.stats.state.retained', 'Showing retained measurements') : undefined}
      provenance={totalScope} />
    {(error != null || refreshError != null) && <QueryError error={error ?? refreshError} onRetry={onRetry} />}
  </section>;
}
