import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function RangeBarWidget({ vehicleId, size }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
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
      comparisonRaw: usesRated ? ideal : rated,
      primaryConverted: primary != null ? convertDistanceFromSI(primary, distanceUnit) : null,
    };
  }, [state, distanceUnit]);
  const headline = (
    <WidgetBigNumber value={range.primaryConverted != null ? fmtInt(range.primaryConverted) : null}
      unit={distanceUnit}
      label={range.usesRated || !range.hasData ? t('widget.ratedRange', 'Rated range') : t('widget.idealRange', 'Ideal range')}
      animated={false} />
  );
  const comparison = !isCompact && (
    <WidgetBigNumber value={range.comparisonRaw != null ? fmtInt(convertDistanceFromSI(range.comparisonRaw, distanceUnit)) : null}
      unit={distanceUnit} label={range.usesRated ? t('widget.idealRange', 'Ideal range') : t('widget.ratedRange', 'Rated range')}
      animated={false} size="secondary" />
  );
  const empty = !range.hasData && (
    <EmptyState variant="informational" icon={<Gauge className="h-6 w-6" />}
      message={t('widget.noRange', 'No range data')} className="py-4" />
  );

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
      <InstrumentPresentation family="meter" compact={isCompact} headline={headline}
        icon={<Gauge />} details={!isCompact || !range.hasData ? <>{comparison}{empty}</> : undefined}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-end justify-between gap-3">
          {headline}
          {comparison}
        </div>
        {empty}
      </div>
      </InstrumentPresentation>
    </WidgetShell>
  );
}
