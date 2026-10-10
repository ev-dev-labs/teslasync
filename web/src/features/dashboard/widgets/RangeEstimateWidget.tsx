import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import type { StatMetric } from '@/components/data-display';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';
import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import { useDataState } from '@/hooks/useDataState';
import type { WidgetProps } from './types';

/**
 * Format an SI range (metres) for display in the user's distance unit.
 *
 * A genuinely-absent reading (null / undefined / NaN) renders the em-dash
 * placeholder rather than a fabricated "0 km": a coalesced zero is
 * indistinguishable from "no data" and reads as a dead battery. A real,
 * finite zero is preserved and shown as "0 <unit>". Exported for unit testing.
 */
export function formatRange(
  meters: number | null | undefined,
  distanceUnit: DistanceUnitPref,
): string {
  if (!isFiniteNumber(meters)) return '—';
  return `${fmtNumber(convertDistanceFromSI(meters, distanceUnit))} ${distanceUnit}`;
}

export default function RangeEstimateWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id);
  const {
    data: stateData,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const trust = useDataState(query, { provenance: query.data?.live ? 'live' : 'cached', maxAgeMs: 120_000 });
  /* SI-floor: state.rated_range / state.ideal_range arrive in METERS. */
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const state = stateData?.state;
  const metrics: StatMetric[] = [{
    metricId: 'distance',
    occurrenceId: 'range-estimate-ideal-distance',
    rawValue: state?.ideal_range,
    label: t('widget.idealRange', 'Ideal range'),
    description: t('widget.rangeEstimate.idealSource', 'Returned ideal-range estimate in meters; not measured achievable distance.'),
    display: { formatter: raw => ({ value: formatRange(raw, distanceUnit), unit: '' }) },
  }];

  return (
    <WidgetShell
      title={t('widget.range', 'Range')}
      loading={isLoading}
      dataState={stateData != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <WidgetBigNumber
          label={t('widget.ratedRange', 'Rated range')}
          value={isFiniteNumber(state?.rated_range) ? formatRange(state.rated_range, distanceUnit) : null}
          animated={false}
        />
        <DashboardSourceBrief
          metrics={metrics}
          state={trust}
          eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
          title={t('widget.rangeEstimate.summaryTitle', 'Ideal-range reference')}
          description={t('widget.rangeEstimate.summaryDescription', 'The ideal-range estimate is a separate reference from the rated-range hero; neither estimate measures achievable driving distance or a fleet aggregate.')}
          scope={t('widget.rangeEstimate.summaryScope', 'Vehicle {{id}} · returned state snapshot; observation bounds and recording completeness are not supplied.', { id: id || '—' })}
          testId="dashboard-range-estimate-ideal-brief"
        />
        {!state && (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Gauge className="h-6 w-6" />}
            message={t('widget.noRange', 'No range data')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
