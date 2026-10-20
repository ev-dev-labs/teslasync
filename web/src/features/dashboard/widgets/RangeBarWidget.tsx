import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import type { StatMetric } from '@/components/data-display';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function RangeBarWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id);
  const { data: stateData, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  const trust = useDataState(query, { provenance: stateData?.live ? 'live' : 'cached', maxAgeMs: 120_000 });
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const state = stateData?.state;

  const isCompact = size.cols === 1 && size.rows === 1;

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // SI-floor: state.rated_range / state.ideal_range arrive in METERS. Everything
  // downstream converts to the user's display unit exactly once, here.
  const range = useMemo(() => {
    const rated = knownNumber(state?.rated_range);
    const ideal = knownNumber(state?.ideal_range);
    // The compact headline prefers the rated figure but falls back to the ideal
    // range when rated is unknown (0), so a vehicle that only reports an ideal
    // range never surfaces a misleading "0".
    const usesRated = rated != null && (rated > 0 || ideal == null || ideal === 0);
    const primary = usesRated ? rated : ideal;
    return {
      hasData: rated != null || ideal != null,
      usesRated,
      comparisonRaw: usesRated ? state?.ideal_range : state?.rated_range,
      primaryConverted: primary != null ? convertDistanceFromSI(primary, distanceUnit) : null,
      // Percentage variance of ideal vs. rated. Unit-independent (a ratio), so
      // it is computed from the SI values. Null when either side is unknown to
      // avoid a divide-by-zero and a meaningless "±0%" readout.
      variancePct: rated != null && ideal != null && rated > 0 && ideal > 0 ? ((ideal - rated) / rated) * 100 : null,
    };
  }, [state, distanceUnit]);

  const comparisonMetrics = useMemo<StatMetric[]>(() => [
    {
      metricId: 'distance',
      occurrenceId: 'range-secondary-distance',
      rawValue: range.comparisonRaw,
      label: range.usesRated ? t('widget.idealRange', 'Ideal range') : t('widget.ratedRange', 'Rated range'),
      description: t('widget.rangeBarBrief.distanceSource', 'Secondary vehicle range reading in source meters, distinct from the preferred primary range.'),
      display: { formatter: raw => ({ value: fmtNumber(convertDistanceFromSI(raw, distanceUnit)), unit: distanceUnit }) },
    },
    ...(range.variancePct != null ? [{
      metricId: 'percent' as const,
      occurrenceId: 'range-epa-variance',
      rawValue: range.variancePct,
      label: t('widget.epaComparison', 'EPA variance'),
      description: t('widget.rangeBarBrief.varianceSource', 'Ideal minus rated range, divided by rated range; shown only when both source readings are positive.'),
      display: { formatter: (raw: number) => ({ value: `${raw >= 0 ? '+' : ''}${fmtNumber(raw)}`, unit: '%' }) },
    }] : []),
  ], [range, distanceUnit, fmtNumber, t]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.rangeBar', 'Range')}
      icon={isCompact ? undefined : <Gauge className="h-3 w-3 text-[var(--text-muted)]" />}
      loading={isLoading || vehiclesLoading}
      dataState={stateData != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <WidgetBigNumber
          value={range.primaryConverted != null ? fmtNumber(range.primaryConverted) : null}
          unit={distanceUnit}
          label={range.usesRated || !range.hasData ? t('widget.ratedRange', 'Rated range') : t('widget.idealRange', 'Ideal range')}
          animated={false}
        />
        {!isCompact && <DashboardSourceBrief
          metrics={comparisonMetrics}
          state={trust}
          eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
          title={t('widget.rangeBarBrief.title', 'Range comparison')}
          description={t('widget.rangeBarBrief.description', 'The secondary range and optional EPA variance retain the vehicle snapshot source; the primary range preference is unchanged.')}
          scope={t('widget.rangeBarBrief.scope', 'Vehicle {{id}} · range snapshot; exact observation bounds and recording completeness are not supplied.', { id })}
          testId="dashboard-range-comparison-brief"
        />}
        {!range.hasData && (
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
