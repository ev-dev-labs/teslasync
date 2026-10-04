import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
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
      ratedConverted: rated != null ? convertDistanceFromSI(rated, distanceUnit) : null,
      idealConverted: ideal != null ? convertDistanceFromSI(ideal, distanceUnit) : null,
      primaryConverted: primary != null ? convertDistanceFromSI(primary, distanceUnit) : null,
      // Percentage variance of ideal vs. rated. Unit-independent (a ratio), so
      // it is computed from the SI values. Null when either side is unknown to
      // avoid a divide-by-zero and a meaningless "±0%" readout.
      variancePct: rated != null && ideal != null && rated > 0 && ideal > 0 ? ((ideal - rated) / rated) * 100 : null,
    };
  }, [state, distanceUnit]);

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
        {!isCompact && <WidgetStatGrid stats={[
          {
            label: range.usesRated ? t('widget.idealRange', 'Ideal range') : t('widget.ratedRange', 'Rated range'),
            value: range.usesRated
              ? range.idealConverted != null ? `${fmtNumber(range.idealConverted)} ${distanceUnit}` : null
              : range.ratedConverted != null ? `${fmtNumber(range.ratedConverted)} ${distanceUnit}` : null,
          },
          ...(range.variancePct != null ? [{
            label: t('widget.epaComparison', 'EPA variance'),
            value: `${range.variancePct >= 0 ? '+' : ''}${fmtNumber(range.variancePct)}%`,
          }] : []),
        ]} />}
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
