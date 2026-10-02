import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Calendar, TrendingUp } from 'lucide-react';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useDrivingStats } from '@/api/hooks/useDriving';
import { knownNumber } from '@/api/dataState';
import { useCombinedDataState, useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';

/**
 * Convert the live odometer to the user's display unit. `VehicleState.odometer`
 * is SI **metres** (the `/vehicles/{id}/state` contract — see VehicleHeroCard),
 * so it feeds the shared metre-floor `convertDistanceFromSI` directly. A
 * non-finite payload collapses to 0 so the counter never renders "NaN".
 */
export function toOdometerDisplay(odometerMeters: number, to: DistanceUnitPref): number {
  if (!Number.isFinite(odometerMeters)) return 0;
  return convertDistanceFromSI(odometerMeters, to);
}

/**
 * Convert a `DrivingStats.totalDistanceKm` value to the user's display unit.
 * That field is a legacy display scalar in **kilometres**, NOT SI — but the
 * shared `convertDistanceFromSI` expects **metres**, so the value is scaled to
 * metres first (the same bridge `EfficiencyPage`, `FleetComparePage`, and
 * `FleetStatsBarWidget` apply). Passing kilometres straight through previously
 * under-reported total-driven distance by 1000× (5,000 km surfaced as 5 km). A
 * non-finite payload collapses to 0 so the tile never renders "NaN".
 */
export function toTotalDrivenDisplay(totalDistanceKm: number, to: DistanceUnitPref): number {
  if (!Number.isFinite(totalDistanceKm)) return 0;
  return convertDistanceFromSI(totalDistanceKm * 1000, to);
}

export default function OdometerCounterWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const idStr = id > 0 ? String(id) : undefined;

  const stateQuery = useVehicleState(id);
  const statsQuery = useDrivingStats(idStr);
  const { data: stateData, isLoading: stateLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = stateQuery;
  const { data: stats, isLoading: statsLoading } = statsQuery;
  const trust = useDataState({ ...stateQuery, data: stateData ?? undefined }, { provenance: stateData?.live ? 'live' : 'cached' });
  const statsTrust = useDataState({ ...statsQuery, data: stats ?? undefined }, { provenance: 'historical' });
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;

  const isCompact = size.cols === 1 && size.rows === 1;
  const isWide = size.cols >= 2;
  const combined = useCombinedDataState(isWide ? [trust, statsTrust] : [trust]);
  const shellTrust = trust.hasData || !isWide ? trust : {
    ...trust,
    ...combined,
    hasData: trust.hasData || (isWide && statsTrust.hasData),
  };

  const odometer = knownNumber(stateData?.state?.odometer);
  const totalDistanceKm = knownNumber(stats?.totalDistanceKm);

  const convertedOdometer = useMemo(
    () => (odometer != null ? toOdometerDisplay(odometer, distanceUnit) : null),
    [odometer, distanceUnit],
  );
  const convertedTotalDriven = useMemo(
    () => (totalDistanceKm != null ? toTotalDrivenDisplay(totalDistanceKm, distanceUnit) : null),
    [totalDistanceKm, distanceUnit],
  );

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.odometer.title', 'Odometer')}
      icon={isCompact ? undefined : <Gauge className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={stateLoading}
      dataState={stateData != null || stateLoading || isError || error ? shellTrust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => { void refetch(); void statsQuery.refetch?.(); }}
    >
      {trust.fatalError ? (
        <QueryError error={trust.fatalError} onRetry={trust.retry ?? undefined} />
      ) : stateLoading && !stateData ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : convertedOdometer != null ? (
        isCompact ? (
          <WidgetBigNumber
            value={convertedOdometer}
            unit={distanceUnit}
            decimals={0}
          />
        ) : (
          <ExpandedView
            odometer={convertedOdometer}
            unit={distanceUnit}
          />
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Gauge className="h-6 w-6" />}
          message={t('widget.odometer.noData', 'No odometer data')}
          className="py-4"
        />
      )}
      {!isCompact && isWide && (
        <div className="mt-3 min-w-0">
          <StaleRefreshWarning state={statsTrust} />
          {statsTrust.fatalError ? (
            <QueryError error={statsTrust.fatalError} onRetry={statsTrust.retry ?? undefined} />
          ) : statsLoading && !stats ? (
            <Skeleton className="h-16 rounded-xl" />
          ) : (
            <WidgetStatGrid cols={2} stats={[
              { label: t('widget.odometer.totalDriven', 'Total driven'), value: convertedTotalDriven == null ? null : `${fmtNumber(convertedTotalDriven, 0)} ${distanceUnit}`, icon: <TrendingUp className="h-3.5 w-3.5" /> },
              { label: t('widget.odometer.unit', 'Unit'), value: distanceUnit, icon: <Calendar className="h-3.5 w-3.5" /> },
            ]} />
          )}
        </div>
      )}
    </WidgetShell>
  );
}

function ExpandedView({
  odometer,
  unit,
}: {
  odometer: number;
  unit: string;
}) {
  const { t } = useTranslation('dashboard');

  return (
    <WidgetBigNumber value={`${fmtNumber(odometer, 0)} ${unit}`} label={t('widget.odometer.total', 'Total odometer')} />
  );
}
