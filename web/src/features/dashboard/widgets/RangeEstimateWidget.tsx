import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';
import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
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
  return `${fmtNumber(convertDistanceFromSI(meters, distanceUnit), 0)} ${distanceUnit}`;
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

  return (
    <WidgetShell
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
        <WidgetStatGrid stats={[{
          label: t('widget.idealRange', 'Ideal range'),
          value: isFiniteNumber(state?.ideal_range) ? formatRange(state.ideal_range, distanceUnit) : null,
        }]} />
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
